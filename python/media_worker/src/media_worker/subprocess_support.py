from __future__ import annotations

import math
import os
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping

from .errors import MediaAdapterError


SAFE_ENV_KEYS = (
    "HOME",
    "LANG",
    "LOCALAPPDATA",
    "PATH",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
)


@dataclass(frozen=True)
class CommandResult:
    stdout: bytes
    stderr: bytes
    returncode: int


@dataclass
class _StreamCapture:
    buffer: bytearray
    overflowed: bool = False
    failed: bool = False


CommandRunner = Callable[..., CommandResult | Mapping[str, object]]


def _stable_error(code: str, message: str) -> MediaAdapterError:
    error = MediaAdapterError(code, message)
    error.__cause__ = None
    error.__context__ = None
    error.__suppress_context__ = True
    return error


def _positive_int(value: object, *, error_code: str, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise _stable_error(error_code, f"{field_name} must be a positive integer")
    return value


def _positive_timeout(value: object, *, error_code: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _stable_error(error_code, "timeout_seconds must be a positive number")
    timeout_seconds = float(value)
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise _stable_error(error_code, "timeout_seconds must be a positive number")
    return timeout_seconds


def _sanitize_path_root(workspace_root: Path, *, error_code: str, error_message: str) -> Path:
    root_error = False
    try:
        root = workspace_root.resolve(strict=False)
        root_exists = root.exists()
        root_is_dir = root.is_dir()
    except Exception:
        root_error = True
        root = workspace_root
        root_exists = False
        root_is_dir = False
    if root_error:
        raise _stable_error(error_code, error_message)
    if not root_exists or not root_is_dir:
        raise _stable_error(error_code, error_message)
    return root


def _is_within_root(root: Path, candidate: Path) -> bool:
    return candidate == root or root in candidate.parents


def ensure_workspace_file(
    workspace_root: Path,
    candidate_path: Path,
    *,
    error_code: str,
    error_message: str,
) -> Path:
    root = _sanitize_path_root(
        workspace_root,
        error_code=error_code,
        error_message=error_message,
    )
    candidate_error = False
    try:
        resolved = candidate_path.resolve(strict=False)
        within_root = _is_within_root(root, resolved)
        resolved_exists = resolved.exists()
        resolved_is_file = resolved.is_file()
    except Exception:
        candidate_error = True
        resolved = candidate_path
        within_root = False
        resolved_exists = False
        resolved_is_file = False
    if candidate_error:
        raise _stable_error(error_code, error_message)
    if not within_root or not resolved_exists or not resolved_is_file:
        raise _stable_error(error_code, error_message)
    return resolved


def ensure_workspace_directory(workspace_root: Path, relative_directory: str) -> Path:
    root = _sanitize_path_root(
        workspace_root,
        error_code="MEDIA_TRANSCODE_FAILED",
        error_message="Output directory is not accessible",
    )
    if not isinstance(relative_directory, str) or not relative_directory:
        raise _stable_error("MEDIA_TRANSCODE_FAILED", "Output directory is invalid")
    resolve_error = False
    try:
        candidate = (root / relative_directory).resolve(strict=False)
        within_root = _is_within_root(root, candidate)
    except Exception:
        resolve_error = True
        candidate = root / relative_directory
        within_root = False
    if resolve_error:
        raise _stable_error("MEDIA_TRANSCODE_FAILED", "Output directory is invalid")
    if not within_root:
        raise _stable_error("MEDIA_TRANSCODE_FAILED", "Output directory is invalid")
    mkdir_error = False
    try:
        candidate.mkdir(parents=True, exist_ok=True)
    except Exception:
        mkdir_error = True
    if mkdir_error:
        raise _stable_error("MEDIA_TRANSCODE_FAILED", "Output directory is invalid")
    return candidate


def sanitize_subprocess_env() -> dict[str, str]:
    return {
        key: value
        for key, value in os.environ.items()
        if key in SAFE_ENV_KEYS and value
    }


def normalize_command_result(
    result: CommandResult | Mapping[str, object],
    *,
    max_stdout_bytes: int | None = None,
    max_stderr_bytes: int | None = None,
) -> CommandResult:
    stdout_limit = (
        None
        if max_stdout_bytes is None
        else _positive_int(
            max_stdout_bytes,
            error_code="MEDIA_SUBPROCESS_FAILED",
            field_name="max_stdout_bytes",
        )
    )
    stderr_limit = (
        None
        if max_stderr_bytes is None
        else _positive_int(
            max_stderr_bytes,
            error_code="MEDIA_SUBPROCESS_FAILED",
            field_name="max_stderr_bytes",
        )
    )
    if isinstance(result, CommandResult):
        normalized = result
    else:
        if not isinstance(result, Mapping):
            raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess returned an invalid result")
        stdout = result.get("stdout", b"")
        stderr = result.get("stderr", b"")
        returncode = result.get("returncode", 0)
        if (
            not isinstance(stdout, bytes)
            or not isinstance(stderr, bytes)
            or isinstance(returncode, bool)
            or not isinstance(returncode, int)
        ):
            raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess returned an invalid result")
        normalized = CommandResult(stdout=stdout, stderr=stderr, returncode=returncode)
    if stdout_limit is not None and len(normalized.stdout) > stdout_limit:
        raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess output exceeded limits")
    if stderr_limit is not None and len(normalized.stderr) > stderr_limit:
        raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess output exceeded limits")
    return normalized


def _terminate_process(process: subprocess.Popen[bytes]) -> bool:
    try:
        running = process.poll() is None
    except Exception:
        running = True
    if running:
        try:
            process.kill()
        except Exception:
            pass
    try:
        process.wait(timeout=1.0)
    except Exception:
        return False
    try:
        return process.poll() is not None
    except Exception:
        return False


def _close_pipe(stream: object | None) -> None:
    if stream is None:
        return
    try:
        close = getattr(stream, "close", None)
        if callable(close):
            close()
    except Exception:
        pass


def _read_stream(
    stream,
    *,
    limit: int,
    capture: _StreamCapture,
    stop_event: threading.Event,
) -> None:
    try:
        while not stop_event.is_set():
            reader = getattr(stream, "read1", None)
            chunk = reader(4096) if callable(reader) else stream.read(4096)
            if not chunk:
                break
            remaining = limit - len(capture.buffer)
            if remaining > 0:
                capture.buffer.extend(chunk[:remaining])
            if len(chunk) > remaining:
                capture.overflowed = True
                stop_event.set()
                break
    except Exception:
        capture.failed = True
        stop_event.set()
    finally:
        try:
            stream.close()
        except Exception:
            pass


def run_command(
    args: list[str],
    *,
    timeout_seconds: float,
    max_stdout_bytes: int,
    max_stderr_bytes: int,
    cwd: Path | None = None,
) -> CommandResult:
    if not isinstance(args, list) or not args or any(not isinstance(arg, str) or not arg for arg in args):
        raise MediaAdapterError("MEDIA_SUBPROCESS_FAILED", "Subprocess arguments are invalid")
    validated_timeout = _positive_timeout(timeout_seconds, error_code="MEDIA_SUBPROCESS_FAILED")
    stdout_limit = _positive_int(
        max_stdout_bytes,
        error_code="MEDIA_SUBPROCESS_FAILED",
        field_name="max_stdout_bytes",
    )
    stderr_limit = _positive_int(
        max_stderr_bytes,
        error_code="MEDIA_SUBPROCESS_FAILED",
        field_name="max_stderr_bytes",
    )
    if cwd is not None:
        if not isinstance(cwd, Path):
            raise _stable_error("MEDIA_SUBPROCESS_FAILED", "cwd must be a Path")
        cwd_error = False
        try:
            resolved_cwd = cwd.resolve(strict=False)
            cwd_exists = resolved_cwd.exists()
            cwd_is_dir = resolved_cwd.is_dir()
        except Exception:
            cwd_error = True
            resolved_cwd = cwd
            cwd_exists = False
            cwd_is_dir = False
        if cwd_error:
            raise _stable_error("MEDIA_SUBPROCESS_FAILED", "cwd is invalid")
        if not cwd_exists or not cwd_is_dir:
            raise _stable_error("MEDIA_SUBPROCESS_FAILED", "cwd is invalid")
    else:
        resolved_cwd = None

    process_error: str | None = None
    try:
        process = subprocess.Popen(
            args,
            cwd=None if resolved_cwd is None else str(resolved_cwd),
            env=sanitize_subprocess_env(),
            shell=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (OSError, ValueError):
        process_error = "failed"
    if process_error is not None:
        raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess could not be started")

    assert process.stdout is not None
    assert process.stderr is not None

    stop_event = threading.Event()
    stdout_capture = _StreamCapture(buffer=bytearray())
    stderr_capture = _StreamCapture(buffer=bytearray())
    stdout_thread = threading.Thread(
        target=_read_stream,
        args=(process.stdout,),
        kwargs={"limit": stdout_limit, "capture": stdout_capture, "stop_event": stop_event},
        daemon=True,
    )
    stderr_thread = threading.Thread(
        target=_read_stream,
        args=(process.stderr,),
        kwargs={"limit": stderr_limit, "capture": stderr_capture, "stop_event": stop_event},
        daemon=True,
    )
    stdout_thread.start()
    stderr_thread.start()

    deadline = time.monotonic() + validated_timeout
    timed_out = False
    overflowed = False
    failed_reader = False
    normal_exit = False

    while True:
        if stdout_capture.overflowed or stderr_capture.overflowed:
            overflowed = True
            stop_event.set()
            terminated = _terminate_process(process)
            if not terminated:
                raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess output exceeded limits")
            break
        if stdout_capture.failed or stderr_capture.failed:
            failed_reader = True
            stop_event.set()
            terminated = _terminate_process(process)
            if not terminated:
                raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess output exceeded limits")
            break
        if process.poll() is not None:
            normal_exit = True
            break
        if time.monotonic() >= deadline:
            timed_out = True
            stop_event.set()
            terminated = _terminate_process(process)
            if not terminated:
                raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess timed out")
            break
        time.sleep(0.01)

    if normal_exit:
        remaining_seconds = max(0.0, deadline - time.monotonic())
        stdout_thread.join(timeout=remaining_seconds / 2 if remaining_seconds > 0 else 0.0)
        remaining_seconds = max(0.0, deadline - time.monotonic())
        stderr_thread.join(timeout=remaining_seconds)
        if stdout_thread.is_alive() or stderr_thread.is_alive():
            _close_pipe(process.stdout)
            _close_pipe(process.stderr)
            stop_event.set()
            _terminate_process(process)
            stdout_thread.join(timeout=0.5)
            stderr_thread.join(timeout=0.5)
            if stdout_thread.is_alive() or stderr_thread.is_alive():
                raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess output could not be drained")
    else:
        stop_event.set()
        stdout_thread.join(timeout=1.0)
        stderr_thread.join(timeout=1.0)

    try:
        process_returncode = process.returncode
    except Exception:
        process_returncode = None
    if process_returncode is None:
        try:
            process_returncode = process.wait(timeout=0)
        except Exception:
            process_returncode = None

    if timed_out:
        raise _stable_error("MEDIA_SUBPROCESS_TIMEOUT", "Subprocess timed out")
    if overflowed or failed_reader:
        raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess output exceeded limits")
    if process_returncode is None:
        raise _stable_error("MEDIA_SUBPROCESS_FAILED", "Subprocess could not be reaped")

    return normalize_command_result(
        CommandResult(
            stdout=bytes(stdout_capture.buffer),
            stderr=bytes(stderr_capture.buffer),
            returncode=process_returncode,
        ),
        max_stdout_bytes=stdout_limit,
        max_stderr_bytes=stderr_limit,
    )
