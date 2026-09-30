from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

from media_worker.errors import MediaAdapterError
from media_worker.subprocess_support import (
    ensure_workspace_directory,
    ensure_workspace_file,
    normalize_command_result,
    run_command,
)


def test_run_command_terminates_child_on_stdout_overflow(tmp_path: Path) -> None:
    marker_path = tmp_path / "stdout-marker.txt"
    script = (
        "import pathlib,sys,time;"
        "sys.stdout.write('x'*128);sys.stdout.flush();"
        "time.sleep(0.5);"
        "pathlib.Path(sys.argv[1]).write_text('late', encoding='utf-8')"
    )

    with pytest.raises(MediaAdapterError) as error_info:
        run_command(
            [sys.executable, "-c", script, str(marker_path)],
            timeout_seconds=2.0,
            max_stdout_bytes=32,
            max_stderr_bytes=32,
            cwd=tmp_path,
        )

    assert error_info.value.code == "MEDIA_SUBPROCESS_FAILED"
    time.sleep(0.3)
    assert not marker_path.exists()


def test_run_command_terminates_child_on_stderr_overflow(tmp_path: Path) -> None:
    marker_path = tmp_path / "stderr-marker.txt"
    script = (
        "import pathlib,sys,time;"
        "sys.stderr.write('y'*128);sys.stderr.flush();"
        "time.sleep(0.5);"
        "pathlib.Path(sys.argv[1]).write_text('late', encoding='utf-8')"
    )

    with pytest.raises(MediaAdapterError) as error_info:
        run_command(
            [sys.executable, "-c", script, str(marker_path)],
            timeout_seconds=2.0,
            max_stdout_bytes=32,
            max_stderr_bytes=32,
            cwd=tmp_path,
        )

    assert error_info.value.code == "MEDIA_SUBPROCESS_FAILED"
    time.sleep(0.3)
    assert not marker_path.exists()


def test_run_command_reads_stdout_and_stderr_without_deadlock(tmp_path: Path) -> None:
    script = (
        "import sys;"
        "sys.stdout.write('out-data');sys.stdout.flush();"
        "sys.stderr.write('err-data');sys.stderr.flush()"
    )

    result = run_command(
        [sys.executable, "-c", script],
        timeout_seconds=2.0,
        max_stdout_bytes=64,
        max_stderr_bytes=64,
        cwd=tmp_path,
    )

    assert result.returncode == 0
    assert result.stdout == b"out-data"
    assert result.stderr == b"err-data"


def test_run_command_reads_full_stdout_and_stderr_after_fast_exit(tmp_path: Path) -> None:
    expected_stdout = b"stdout-block-" * 64
    expected_stderr = b"stderr-block-" * 64
    script = (
        "import sys;"
        "sys.stdout.buffer.write(b'stdout-block-' * 64);"
        "sys.stderr.buffer.write(b'stderr-block-' * 64);"
        "sys.stdout.flush();"
        "sys.stderr.flush()"
    )

    for _ in range(10):
        result = run_command(
            [sys.executable, "-c", script],
            timeout_seconds=2.0,
            max_stdout_bytes=4096,
            max_stderr_bytes=4096,
            cwd=tmp_path,
        )

        assert result.returncode == 0
        assert result.stdout == expected_stdout
        assert result.stderr == expected_stderr


def test_run_command_drains_readers_after_process_exit_before_return(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    class FakePipe:
        def close(self) -> None:
            return None

    class FakeProcess:
        def __init__(self) -> None:
            self.stdout = FakePipe()
            self.stderr = FakePipe()
            self.returncode = 0
            self._poll_calls = 0

        def poll(self) -> int | None:
            self._poll_calls += 1
            return 0 if self._poll_calls >= 2 else None

        def wait(self, timeout: float | None = None) -> int:
            return 0

        def kill(self) -> None:
            return None

    process = FakeProcess()

    class FakeThread:
        def __init__(self, *, args: tuple[object, ...], kwargs: dict[str, object], **_: object) -> None:
            self.stream = args[0]
            self.capture = kwargs["capture"]
            self.stop_event = kwargs["stop_event"]
            self._alive = True

        def start(self) -> None:
            if self.stream is process.stdout:
                self.capture.buffer.extend(b"stdout-")
            else:
                self.capture.buffer.extend(b"stderr-")

        def join(self, timeout: float | None = None) -> None:
            if not self.stop_event.is_set():
                self.capture.buffer.extend(b"tail")
            self._alive = False

        def is_alive(self) -> bool:
            return self._alive

    monkeypatch.setattr("media_worker.subprocess_support.subprocess.Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr("media_worker.subprocess_support.threading.Thread", FakeThread)
    monkeypatch.setattr("media_worker.subprocess_support.time.sleep", lambda _seconds: None)

    result = run_command(
        [sys.executable, "-c", "print('unused')"],
        timeout_seconds=1.0,
        max_stdout_bytes=64,
        max_stderr_bytes=64,
        cwd=tmp_path,
    )

    assert result.returncode == 0
    assert result.stdout == b"stdout-tail"
    assert result.stderr == b"stderr-tail"


def test_run_command_timeout_kills_child(tmp_path: Path) -> None:
    marker_path = tmp_path / "timeout-marker.txt"
    script = (
        "import pathlib,sys,time;"
        "time.sleep(2);"
        "pathlib.Path(sys.argv[1]).write_text('late', encoding='utf-8')"
    )

    start = time.monotonic()
    with pytest.raises(MediaAdapterError) as error_info:
        run_command(
            [sys.executable, "-c", script, str(marker_path)],
            timeout_seconds=0.2,
            max_stdout_bytes=64,
            max_stderr_bytes=64,
            cwd=tmp_path,
        )
    duration_seconds = time.monotonic() - start

    assert error_info.value.code == "MEDIA_SUBPROCESS_TIMEOUT"
    assert duration_seconds < 1.5
    time.sleep(0.3)
    assert not marker_path.exists()


@pytest.mark.parametrize(
    ("kwargs", "expected_code"),
    [
        (
            {"timeout_seconds": True, "max_stdout_bytes": 64, "max_stderr_bytes": 64},
            "MEDIA_SUBPROCESS_FAILED",
        ),
        (
            {"timeout_seconds": 1.0, "max_stdout_bytes": False, "max_stderr_bytes": 64},
            "MEDIA_SUBPROCESS_FAILED",
        ),
        (
            {"timeout_seconds": 1.0, "max_stdout_bytes": 64, "max_stderr_bytes": 0},
            "MEDIA_SUBPROCESS_FAILED",
        ),
    ],
)
def test_run_command_validates_limits_and_types(
    tmp_path: Path,
    kwargs: dict[str, object],
    expected_code: str,
) -> None:
    with pytest.raises(MediaAdapterError) as error_info:
        run_command([sys.executable, "-c", "print('ok')"], cwd=tmp_path, **kwargs)

    assert error_info.value.code == expected_code


def test_normalize_command_result_enforces_output_limits() -> None:
    with pytest.raises(MediaAdapterError) as error_info:
        normalize_command_result(
            {"stdout": b"x" * 33, "stderr": b"", "returncode": 0},
            max_stdout_bytes=32,
            max_stderr_bytes=32,
        )

    assert error_info.value.code == "MEDIA_SUBPROCESS_FAILED"


def test_workspace_helpers_hide_sensitive_paths_from_exception_chain(tmp_path: Path) -> None:
    missing_file = tmp_path / "secret-sentinel-missing.wav"

    with pytest.raises(MediaAdapterError) as file_error_info:
        ensure_workspace_file(
            tmp_path,
            missing_file,
            error_code="MEDIA_TRANSCODE_FAILED",
            error_message="Media input is not accessible",
        )

    file_error = file_error_info.value
    assert "secret-sentinel" not in str(file_error)
    assert "secret-sentinel" not in repr(file_error)
    assert file_error.__cause__ is None
    assert file_error.__context__ is None

    with pytest.raises(MediaAdapterError) as dir_error_info:
        ensure_workspace_directory(tmp_path, "../secret-sentinel-output")

    dir_error = dir_error_info.value
    assert "secret-sentinel" not in str(dir_error)
    assert "secret-sentinel" not in repr(dir_error)
    assert dir_error.__cause__ is None
    assert dir_error.__context__ is None


def test_run_command_maps_cwd_resolve_error_to_stable_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    real_resolve = Path.resolve
    secret_cwd = tmp_path / "secret-cwd"
    secret_cwd.mkdir()

    def fake_resolve(self: Path, strict: bool = False) -> Path:
        if self == secret_cwd:
            raise RuntimeError("secret-os-path")
        return real_resolve(self, strict=strict)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    with pytest.raises(MediaAdapterError) as error_info:
        run_command(
            [sys.executable, "-c", "print('ok')"],
            timeout_seconds=1.0,
            max_stdout_bytes=64,
            max_stderr_bytes=64,
            cwd=secret_cwd,
        )

    error = error_info.value
    assert error.code == "MEDIA_SUBPROCESS_FAILED"
    assert "secret-os-path" not in str(error)
    assert "secret-os-path" not in repr(error)
    assert error.__cause__ is None
    assert error.__context__ is None


def test_ensure_workspace_directory_maps_mkdir_error_to_stable_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    real_mkdir = Path.mkdir

    def fake_mkdir(self: Path, parents: bool = False, exist_ok: bool = False) -> None:
        if self.name == "secret-output":
            raise OSError("secret-os-path")
        return real_mkdir(self, parents=parents, exist_ok=exist_ok)

    monkeypatch.setattr(Path, "mkdir", fake_mkdir)

    with pytest.raises(MediaAdapterError) as error_info:
        ensure_workspace_directory(tmp_path, "secret-output")

    error = error_info.value
    assert error.code == "MEDIA_TRANSCODE_FAILED"
    assert "secret-os-path" not in str(error)
    assert "secret-os-path" not in repr(error)
    assert error.__cause__ is None
    assert error.__context__ is None
