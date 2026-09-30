from __future__ import annotations

import hashlib
import math
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from .errors import MediaAdapterError
from .subprocess_support import (
    CommandRunner,
    ensure_workspace_directory,
    ensure_workspace_file,
    normalize_command_result,
    run_command,
)


class ProbeAdapter(Protocol):
    def probe_media(self, input_path: Path, *, source_kind: str | None):
        ...


@dataclass(frozen=True)
class NormalizedAudioResult:
    local_path: Path
    size_bytes: int
    sha256: str
    codec: str
    sample_rate: int
    channels: int
    ffmpeg_version: str

    def to_manifest(self) -> dict[str, object]:
        return {
            "sizeBytes": self.size_bytes,
            "sha256": self.sha256,
            "codec": self.codec,
            "sampleRate": self.sample_rate,
            "channels": self.channels,
            "ffmpegVersion": self.ffmpeg_version,
        }


def _stable_error(code: str, message: str) -> MediaAdapterError:
    error = MediaAdapterError(code, message)
    error.__cause__ = None
    error.__context__ = None
    error.__suppress_context__ = True
    return error


def _positive_int(value: object, *, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise _stable_error("MEDIA_TRANSCODE_FAILED", f"{field_name} must be a positive integer")
    return value


def _positive_timeout(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _stable_error("MEDIA_TRANSCODE_FAILED", "timeout_seconds must be a positive number")
    timeout_seconds = float(value)
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise _stable_error("MEDIA_TRANSCODE_FAILED", "timeout_seconds must be a positive number")
    return timeout_seconds


class FfmpegAdapter:
    def __init__(
        self,
        *,
        workspace_root: Path,
        probe_adapter: ProbeAdapter,
        ffprobe_adapter: ProbeAdapter | None = None,
        ffmpeg_path: str = "ffmpeg",
        command_runner: CommandRunner | None = None,
        create_output_token: Callable[[], str] | None = None,
        timeout_seconds: float = 30.0,
        max_stdout_bytes: int = 64 * 1024,
        max_stderr_bytes: int = 64 * 1024,
        max_output_bytes: int = 32 * 1024 * 1024,
    ) -> None:
        if not isinstance(workspace_root, Path):
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "workspace_root must be a Path")
        workspace_error = False
        try:
            resolved_workspace = workspace_root.resolve(strict=False)
            workspace_exists = resolved_workspace.exists()
            workspace_is_dir = resolved_workspace.is_dir()
        except Exception:
            workspace_error = True
            resolved_workspace = workspace_root
            workspace_exists = False
            workspace_is_dir = False
        if workspace_error:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "workspace_root is invalid")
        if not workspace_exists or not workspace_is_dir:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "workspace_root is invalid")
        if not isinstance(ffmpeg_path, str) or not ffmpeg_path.strip():
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "ffmpeg_path is invalid")
        if not self._has_probe_media(probe_adapter):
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "probe_adapter is invalid")
        if ffprobe_adapter is not None and not self._has_probe_media(ffprobe_adapter):
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "ffprobe_adapter is invalid")
        if command_runner is not None and not callable(command_runner):
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "command_runner must be callable")
        if create_output_token is not None and not callable(create_output_token):
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "create_output_token must be callable")

        self.workspace_root = resolved_workspace
        self.probe_adapter = probe_adapter
        self.ffprobe_adapter = ffprobe_adapter or probe_adapter
        self.ffmpeg_path = ffmpeg_path
        self.command_runner = command_runner or run_command
        self.create_output_token = create_output_token or (lambda: str(uuid.uuid4()))
        self.timeout_seconds = _positive_timeout(timeout_seconds)
        self.max_stdout_bytes = _positive_int(max_stdout_bytes, field_name="max_stdout_bytes")
        self.max_stderr_bytes = _positive_int(max_stderr_bytes, field_name="max_stderr_bytes")
        self.max_output_bytes = _positive_int(max_output_bytes, field_name="max_output_bytes")
        self._cached_version: str | None = None

    def normalize_audio(self, input_path: Path) -> NormalizedAudioResult:
        resolved_input = ensure_workspace_file(
            self.workspace_root,
            input_path,
            error_code="MEDIA_TRANSCODE_FAILED",
            error_message="Media input is not accessible",
        )
        probe_error_code: str | None = None
        try:
            probe_result = self.probe_adapter.probe_media(resolved_input, source_kind=None)
        except MediaAdapterError as error:
            probe_error_code = self._map_probe_error_code(error.code)
        except Exception:
            probe_error_code = "MEDIA_TRANSCODE_FAILED"
        if probe_error_code is not None:
            raise _stable_error(probe_error_code, self._error_message_for_code(probe_error_code))
        if getattr(probe_result, "has_audio", False) is not True:
            raise _stable_error("MEDIA_AUDIO_TRACK_MISSING", "Audio track is missing")

        output_directory = ensure_workspace_directory(self.workspace_root, "normalized-audio")
        output_path_error = False
        try:
            final_path, partial_path = self._build_output_paths(output_directory)
        except MediaAdapterError:
            output_path_error = True
        except Exception:
            output_path_error = True
        if output_path_error:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Audio normalization failed")
        ffmpeg_version = self._get_ffmpeg_version()

        command_args = [
            self.ffmpeg_path,
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-n",
            "-i",
            str(resolved_input),
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            "-fs",
            str(self.max_output_bytes),
            str(partial_path),
        ]

        command_error_code: str | None = None
        command_result = None
        try:
            raw_result = self.command_runner(
                command_args,
                timeout_seconds=self.timeout_seconds,
                max_stdout_bytes=self.max_stdout_bytes,
                max_stderr_bytes=self.max_stderr_bytes,
                cwd=self.workspace_root,
            )
            command_result = normalize_command_result(
                raw_result,
                max_stdout_bytes=self.max_stdout_bytes,
                max_stderr_bytes=self.max_stderr_bytes,
            )
        except MediaAdapterError as error:
            command_error_code = self._map_command_error_code(error.code)
        except Exception:
            command_error_code = "MEDIA_TRANSCODE_FAILED"
        if command_error_code is not None:
            self._cleanup_local_output(partial_path=partial_path, final_path=None)
            raise _stable_error(command_error_code, self._command_error_message(command_error_code))

        if command_result.returncode != 0 or not partial_path.exists():
            self._cleanup_local_output(partial_path=partial_path, final_path=None)
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Audio normalization failed")

        stat_error = False
        try:
            partial_size_bytes = partial_path.stat().st_size
        except Exception:
            self._cleanup_local_output(partial_path=partial_path, final_path=None)
            stat_error = True
        if stat_error:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Audio normalization failed")
        if partial_size_bytes > self.max_output_bytes:
            self._cleanup_local_output(partial_path=partial_path, final_path=None)
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Audio normalization failed")

        if not self._publish_partial_output(partial_path, final_path):
            self._cleanup_local_output(partial_path=partial_path, final_path=None)
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Audio normalization failed")

        try:
            verification_result = self._verify_normalized_output(final_path)
        except Exception:
            verification_result = None
        if verification_result is None:
            self._cleanup_local_output(partial_path=None, final_path=final_path)
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Audio normalization failed")

        output_finalize_error = False
        try:
            sha256 = self._sha256_file(final_path)
            size_bytes = final_path.stat().st_size
        except Exception:
            self._cleanup_local_output(partial_path=None, final_path=final_path)
            output_finalize_error = True
        if output_finalize_error:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Audio normalization failed")
        return NormalizedAudioResult(
            local_path=final_path,
            size_bytes=size_bytes,
            sha256=sha256,
            codec=str(verification_result["codec"]),
            sample_rate=int(verification_result["sampleRate"]),
            channels=int(verification_result["channels"]),
            ffmpeg_version=ffmpeg_version,
        )

    def _get_ffmpeg_version(self) -> str:
        if self._cached_version is not None:
            return self._cached_version
        version_error = False
        version_result = None
        try:
            raw_result = self.command_runner(
                [self.ffmpeg_path, "-version"],
                timeout_seconds=self.timeout_seconds,
                max_stdout_bytes=self.max_stdout_bytes,
                max_stderr_bytes=self.max_stderr_bytes,
                cwd=self.workspace_root,
            )
            version_result = normalize_command_result(
                raw_result,
                max_stdout_bytes=self.max_stdout_bytes,
                max_stderr_bytes=self.max_stderr_bytes,
            )
        except Exception:
            version_error = True
        if version_error or version_result is None or version_result.returncode != 0:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "ffmpeg is unavailable")
        version_decode_error = False
        try:
            decoded_stdout = version_result.stdout.decode("utf-8")
        except UnicodeDecodeError:
            version_decode_error = True
            decoded_stdout = ""
        if version_decode_error:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "ffmpeg is unavailable")
        first_line = decoded_stdout.splitlines()
        if not first_line:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "ffmpeg is unavailable")
        version_parts = first_line[0].strip().split()
        if len(version_parts) < 3:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "ffmpeg is unavailable")
        self._cached_version = version_parts[2]
        return self._cached_version

    def _build_output_paths(self, output_directory: Path) -> tuple[Path, Path]:
        token_error = False
        try:
            token = self.create_output_token()
        except Exception:
            token_error = True
            token = None
        if token_error:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Output token is invalid")
        if not isinstance(token, str):
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Output token is invalid")
        try:
            parsed_uuid = uuid.UUID(token)
        except ValueError:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Output token is invalid")
        if parsed_uuid.version != 4 or str(parsed_uuid) != token or token != token.lower():
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Output token is invalid")
        final_path = (output_directory / f"{token}.wav").resolve(strict=False)
        partial_path = (output_directory / f"{token}.wav.partial").resolve(strict=False)
        if final_path.parent != output_directory or partial_path.parent != output_directory:
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Output path is invalid")
        if final_path.exists() or partial_path.exists():
            raise _stable_error("MEDIA_TRANSCODE_FAILED", "Normalized audio target already exists")
        return final_path, partial_path

    def _publish_partial_output(self, partial_path: Path, final_path: Path) -> bool:
        try:
            os.link(partial_path, final_path)
        except FileExistsError:
            return False
        except OSError:
            return False
        try:
            partial_path.unlink()
        except OSError:
            self._cleanup_local_output(partial_path=None, final_path=final_path)
            return False
        return True

    def _verify_normalized_output(self, final_path: Path) -> dict[str, int | str] | None:
        try:
            probe_result = self.ffprobe_adapter.probe_media(final_path, source_kind="audio")
        except Exception:
            return None
        has_audio = getattr(probe_result, "has_audio", False)
        has_video = getattr(probe_result, "has_video", False)
        primary_audio_stream_index = getattr(probe_result, "primary_audio_stream_index", None)
        streams = getattr(probe_result, "streams", None)
        if has_audio is not True or has_video is not False:
            return None
        if not isinstance(primary_audio_stream_index, int) or not isinstance(streams, list):
            return None
        audio_streams = [stream for stream in streams if isinstance(stream, dict) and stream.get("codecType") == "audio"]
        if len(audio_streams) != 1:
            return None
        primary_stream = audio_streams[0]
        if primary_stream.get("index") != primary_audio_stream_index:
            return None
        codec_name = primary_stream.get("codecName")
        audio_info = primary_stream.get("audio")
        if codec_name != "pcm_s16le" or not isinstance(audio_info, dict):
            return None
        sample_rate = audio_info.get("sampleRate")
        channels = audio_info.get("channels")
        if sample_rate != 16000 or channels != 1:
            return None
        return {"codec": "pcm_s16le", "sampleRate": 16000, "channels": 1}

    def _sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while True:
                chunk = stream.read(64 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return digest.hexdigest()

    def _cleanup_local_output(self, *, partial_path: Path | None, final_path: Path | None) -> None:
        if partial_path is not None and partial_path.exists():
            try:
                partial_path.unlink()
            except OSError:
                pass
        if final_path is not None and final_path.exists():
            try:
                final_path.unlink()
            except OSError:
                pass

    def _map_command_error_code(self, command_error_code: str) -> str:
        if command_error_code == "MEDIA_SUBPROCESS_TIMEOUT":
            return "MEDIA_TRANSCODE_TIMEOUT"
        return "MEDIA_TRANSCODE_FAILED"

    def _map_probe_error_code(self, probe_error_code: str) -> str:
        if probe_error_code == "MEDIA_AUDIO_TRACK_MISSING":
            return "MEDIA_AUDIO_TRACK_MISSING"
        return "MEDIA_TRANSCODE_FAILED"

    def _command_error_message(self, command_error_code: str) -> str:
        if command_error_code == "MEDIA_TRANSCODE_TIMEOUT":
            return "Audio normalization timed out"
        return "Audio normalization failed"

    def _error_message_for_code(self, error_code: str) -> str:
        if error_code == "MEDIA_AUDIO_TRACK_MISSING":
            return "Audio track is missing"
        return "Audio normalization failed"

    @staticmethod
    def _has_probe_media(candidate: object) -> bool:
        return callable(getattr(candidate, "probe_media", None))
