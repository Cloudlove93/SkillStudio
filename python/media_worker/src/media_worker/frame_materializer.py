from __future__ import annotations

import hashlib
import os
import re
import threading
import uuid
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol, Sequence

from PIL import Image, UnidentifiedImageError

from .errors import MediaAdapterError
from .subprocess_support import (
    CommandRunner,
    ensure_workspace_directory,
    ensure_workspace_file,
    normalize_command_result,
    run_command,
)


SOURCE_SIGNALS = {
    "semantic_moment",
    "slow_visual_change",
    "transcript_visual_cue",
    "scene_change",
    "periodic_fallback",
}
SAFE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SAFE_TOOL_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$")
MAX_PROCESSOR_VERSION_LENGTH = 128
MAX_SELECTION_REASON_LENGTH = 512
MAX_SAFE_INTEGER = 2**53 - 1
MAX_TIMEOUT_SECONDS = 600.0
MAX_WIDTH = 4096
MAX_OUTPUT_BYTES = 64 * 1024 * 1024
MAX_STDIO_BYTES = 4 * 1024 * 1024
MAX_IMAGE_PIXELS = 64_000_000
_PIL_IMAGE_PIXELS_LOCK = threading.Lock()


def _stable_error(code: str, message: str) -> MediaAdapterError:
    error = MediaAdapterError(code, message)
    error.__cause__ = None
    error.__context__ = None
    error.__suppress_context__ = True
    return error


def _positive_int(value: object, *, field_name: str, error_code: str, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise _stable_error(error_code, f"{field_name} is invalid")
    if maximum is not None and value > maximum:
        raise _stable_error(error_code, f"{field_name} is invalid")
    return value


def _positive_number(value: object, *, field_name: str, error_code: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _stable_error(error_code, f"{field_name} is invalid")
    numeric: float | None = None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        numeric = None
    if numeric is None or not (numeric > 0) or not (numeric < float("inf")) or numeric > MAX_TIMEOUT_SECONDS:
        raise _stable_error(error_code, f"{field_name} is invalid")
    return numeric


def _safe_identifier(value: object, *, field_name: str) -> str:
    if not isinstance(value, str) or not SAFE_ID_PATTERN.fullmatch(value):
        raise _stable_error("FRAME_MATERIALIZE_FAILED", f"{field_name} is invalid")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise _stable_error("FRAME_MATERIALIZE_FAILED", f"{field_name} is invalid")
    return value


def _safe_tool_version(value: object, *, field_name: str) -> str:
    if not isinstance(value, str) or not SAFE_TOOL_VERSION_PATTERN.fullmatch(value):
        raise _stable_error("FRAME_MATERIALIZE_FAILED", f"{field_name} is invalid")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise _stable_error("FRAME_MATERIALIZE_FAILED", f"{field_name} is invalid")
    return value


def _safe_text(value: object, *, field_name: str, maximum_length: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum_length:
        raise _stable_error("FRAME_MATERIALIZE_FAILED", f"{field_name} is invalid")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise _stable_error("FRAME_MATERIALIZE_FAILED", f"{field_name} is invalid")
    return value


def _safe_attribute(obj: object, attribute_name: str, *, error_code: str, field_name: str) -> object:
    failed = False
    value: object = None
    try:
        value = getattr(obj, attribute_name)
    except Exception:
        failed = True
    if failed:
        raise _stable_error(error_code, f"{field_name} is invalid")
    return value


class ProbeAdapter(Protocol):
    def probe_media(self, input_path: Path, *, source_kind: str | None):
        ...


@dataclass(frozen=True)
class FrameRequest:
    candidate_id: str
    semantic_moment_id: str
    timestamp_ms: int
    source_signal: str
    selection_reason: str

    def __post_init__(self) -> None:
        _safe_identifier(self.candidate_id, field_name="candidate_id")
        _safe_identifier(self.semantic_moment_id, field_name="semantic_moment_id")
        if not isinstance(self.source_signal, str) or self.source_signal not in SOURCE_SIGNALS:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "source_signal is invalid")
        _safe_text(
            self.selection_reason,
            field_name="selection_reason",
            maximum_length=MAX_SELECTION_REASON_LENGTH,
        )
        if (
            isinstance(self.timestamp_ms, bool)
            or not isinstance(self.timestamp_ms, int)
            or self.timestamp_ms < 0
            or self.timestamp_ms > MAX_SAFE_INTEGER
        ):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "timestamp_ms is invalid")


@dataclass(frozen=True)
class FrameMaterializerConfig:
    processor_version: str
    max_candidates: int
    max_width: int
    max_output_bytes: int
    max_image_pixels: int
    timeout_seconds: float
    max_stdout_bytes: int
    max_stderr_bytes: int
    create_output_token: Callable[[], str]

    def __post_init__(self) -> None:
        _safe_identifier(
            self.processor_version,
            field_name="processor_version",
        )
        _positive_int(
            self.max_candidates,
            field_name="max_candidates",
            error_code="FRAME_MATERIALIZE_FAILED",
            maximum=48,
        )
        _positive_int(
            self.max_width,
            field_name="max_width",
            error_code="FRAME_MATERIALIZE_FAILED",
            maximum=MAX_WIDTH,
        )
        _positive_int(
            self.max_output_bytes,
            field_name="max_output_bytes",
            error_code="FRAME_MATERIALIZE_FAILED",
            maximum=MAX_OUTPUT_BYTES,
        )
        _positive_int(
            self.max_image_pixels,
            field_name="max_image_pixels",
            error_code="FRAME_MATERIALIZE_FAILED",
            maximum=MAX_IMAGE_PIXELS,
        )
        _positive_number(
            self.timeout_seconds,
            field_name="timeout_seconds",
            error_code="FRAME_MATERIALIZE_FAILED",
        )
        _positive_int(
            self.max_stdout_bytes,
            field_name="max_stdout_bytes",
            error_code="FRAME_MATERIALIZE_FAILED",
            maximum=MAX_STDIO_BYTES,
        )
        _positive_int(
            self.max_stderr_bytes,
            field_name="max_stderr_bytes",
            error_code="FRAME_MATERIALIZE_FAILED",
            maximum=MAX_STDIO_BYTES,
        )
        if not callable(self.create_output_token):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "create_output_token is invalid")


@dataclass(frozen=True)
class MaterializedFrame:
    candidate_id: str
    semantic_moment_id: str
    timestamp_ms: int
    source_signal: str
    selection_reason: str
    local_path: Path
    mime_type: str
    size_bytes: int
    sha256: str
    width: int
    height: int
    ffmpeg_version: str
    frame_extractor_version: str

    def __post_init__(self) -> None:
        _safe_identifier(self.candidate_id, field_name="candidate_id")
        _safe_identifier(self.semantic_moment_id, field_name="semantic_moment_id")
        if not isinstance(self.source_signal, str) or self.source_signal not in SOURCE_SIGNALS:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "source_signal is invalid")
        _safe_text(self.selection_reason, field_name="selection_reason", maximum_length=MAX_SELECTION_REASON_LENGTH)
        if (
            isinstance(self.timestamp_ms, bool)
            or not isinstance(self.timestamp_ms, int)
            or self.timestamp_ms < 0
            or self.timestamp_ms > MAX_SAFE_INTEGER
        ):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "timestamp_ms is invalid")
        if not isinstance(self.local_path, Path):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "local_path is invalid")
        if self.mime_type != "image/png":
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "mime_type is invalid")
        if any(
            isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > MAX_SAFE_INTEGER
            for value in (self.size_bytes, self.width, self.height)
        ):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "frame dimensions are invalid")
        if not isinstance(self.sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", self.sha256):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "sha256 is invalid")
        _safe_tool_version(self.ffmpeg_version, field_name="ffmpeg_version")
        _safe_identifier(self.frame_extractor_version, field_name="frame_extractor_version")

    def to_manifest(self) -> dict[str, object]:
        return {
            "candidateId": self.candidate_id,
            "semanticMomentId": self.semantic_moment_id,
            "timestampMs": self.timestamp_ms,
            "sourceSignal": self.source_signal,
            "selectionReason": self.selection_reason,
            "asset": {
                "mimeType": self.mime_type,
                "sizeBytes": self.size_bytes,
                "sha256": self.sha256,
            },
            "width": self.width,
            "height": self.height,
            "ffmpegVersion": self.ffmpeg_version,
            "frameExtractorVersion": self.frame_extractor_version,
        }


class FrameMaterializer:
    def __init__(
        self,
        *,
        workspace_root: Path,
        probe_adapter: ProbeAdapter,
        config: FrameMaterializerConfig,
        ffmpeg_path: str = "ffmpeg",
        command_runner: CommandRunner | None = None,
    ) -> None:
        if not isinstance(workspace_root, Path):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "workspace_root is invalid")
        workspace_failed = False
        try:
            resolved_workspace = workspace_root.resolve(strict=False)
            workspace_exists = resolved_workspace.exists()
            workspace_is_dir = resolved_workspace.is_dir()
        except Exception:
            workspace_failed = True
            resolved_workspace = workspace_root
            workspace_exists = False
            workspace_is_dir = False
        if workspace_failed or not workspace_exists or not workspace_is_dir:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "workspace_root is invalid")
        probe_media_failed = False
        probe_media = None
        try:
            probe_media = getattr(probe_adapter, "probe_media", None)
        except Exception:
            probe_media_failed = True
        if probe_media_failed or not callable(probe_media):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "probe_adapter is invalid")
        if not isinstance(config, FrameMaterializerConfig):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "config is invalid")
        if not isinstance(ffmpeg_path, str) or not ffmpeg_path.strip():
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "ffmpeg_path is invalid")
        if command_runner is not None and not callable(command_runner):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "command_runner is invalid")

        self.workspace_root = resolved_workspace
        self.probe_adapter = probe_adapter
        self.config = config
        self.ffmpeg_path = ffmpeg_path
        self.command_runner = command_runner or run_command
        self._cached_ffmpeg_version: str | None = None

    def materialize_frames(self, video_path: Path, *, requests: Sequence[FrameRequest]) -> list[MaterializedFrame]:
        if isinstance(requests, (str, bytes)) or not isinstance(requests, Sequence):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "requests are invalid")
        sequence_failed = False
        try:
            request_count = len(requests)
            validated_requests = list(requests)
        except Exception:
            sequence_failed = True
            request_count = 0
            validated_requests = []
        if sequence_failed:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "requests are invalid")
        if request_count == 0 or request_count > self.config.max_candidates or len(validated_requests) != request_count:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "requests are invalid")
        if any(not isinstance(request, FrameRequest) for request in validated_requests):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "requests are invalid")
        candidate_ids = [request.candidate_id for request in validated_requests]
        if len(candidate_ids) != len(set(candidate_ids)):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "candidate_id must be unique")

        resolved_video = ensure_workspace_file(
            self.workspace_root,
            video_path,
            error_code="FRAME_MATERIALIZE_FAILED",
            error_message="Video input is not accessible",
        )
        probe_code: str | None = None
        probe_result = None
        try:
            probe_result = self.probe_adapter.probe_media(resolved_video, source_kind="video")
        except MediaAdapterError as error:
            probe_code = "FRAME_MATERIALIZE_TIMEOUT" if error.code == "MEDIA_PROBE_TIMEOUT" else "FRAME_MATERIALIZE_FAILED"
        except Exception:
            probe_code = "FRAME_MATERIALIZE_FAILED"
        if probe_code is not None:
            raise _stable_error(probe_code, self._message_for_code(probe_code))

        has_video = _safe_attribute(probe_result, "has_video", error_code="FRAME_MATERIALIZE_FAILED", field_name="has_video")
        duration_ms = _safe_attribute(probe_result, "duration_ms", error_code="FRAME_MATERIALIZE_FAILED", field_name="duration_ms")
        primary_video_stream_index = _safe_attribute(
            probe_result,
            "primary_video_stream_index",
            error_code="FRAME_MATERIALIZE_FAILED",
            field_name="primary_video_stream_index",
        )
        if has_video is not True:
            raise _stable_error("FRAME_VIDEO_TRACK_MISSING", "Motion video track is missing")
        if (
            isinstance(primary_video_stream_index, bool)
            or not isinstance(primary_video_stream_index, int)
            or primary_video_stream_index < 0
            or primary_video_stream_index > MAX_SAFE_INTEGER
        ):
            raise _stable_error("FRAME_VIDEO_TRACK_MISSING", "Motion video track is missing")
        if (
            isinstance(duration_ms, bool)
            or not isinstance(duration_ms, int)
            or duration_ms <= 0
            or duration_ms > MAX_SAFE_INTEGER
        ):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Video duration is invalid")
        for request in validated_requests:
            if request.timestamp_ms >= duration_ms:
                raise _stable_error("FRAME_MATERIALIZE_FAILED", "timestamp_ms is invalid")

        ffmpeg_version = self._get_ffmpeg_version()
        output_directory = self._ensure_output_directory()
        results: list[MaterializedFrame] = []
        batch_failure_code: str | None = None
        try:
            for request in validated_requests:
                results.append(
                    self._materialize_single_frame(
                        video_path=resolved_video,
                        output_directory=output_directory,
                        primary_video_stream_index=primary_video_stream_index,
                        ffmpeg_version=ffmpeg_version,
                        request=request,
                    )
                )
        except MediaAdapterError:
            self._cleanup_batch_results(results)
            raise
        except Exception:
            self._cleanup_batch_results(results)
            batch_failure_code = "FRAME_MATERIALIZE_FAILED"
        if batch_failure_code is not None:
            raise _stable_error(batch_failure_code, self._message_for_code(batch_failure_code))
        return results

    def _get_ffmpeg_version(self) -> str:
        if self._cached_ffmpeg_version is not None:
            return self._cached_ffmpeg_version
        command_error_code: str | None = None
        result = None
        try:
            raw_result = self.command_runner(
                [self.ffmpeg_path, "-version"],
                timeout_seconds=self.config.timeout_seconds,
                max_stdout_bytes=self.config.max_stdout_bytes,
                max_stderr_bytes=self.config.max_stderr_bytes,
                cwd=self.workspace_root,
            )
            result = normalize_command_result(
                raw_result,
                max_stdout_bytes=self.config.max_stdout_bytes,
                max_stderr_bytes=self.config.max_stderr_bytes,
            )
        except MediaAdapterError as error:
            command_error_code = "FRAME_MATERIALIZE_TIMEOUT" if error.code == "MEDIA_SUBPROCESS_TIMEOUT" else "FRAME_MATERIALIZE_FAILED"
        except Exception:
            command_error_code = "FRAME_MATERIALIZE_FAILED"
        if command_error_code is not None or result is None or result.returncode != 0:
            raise _stable_error(command_error_code or "FRAME_MATERIALIZE_FAILED", self._message_for_code(command_error_code or "FRAME_MATERIALIZE_FAILED"))

        decoded_stdout: str | None = None
        try:
            decoded_stdout = result.stdout.decode("utf-8")
        except UnicodeDecodeError:
            decoded_stdout = None
        if decoded_stdout is None:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Frame materialization failed")
        first_line = decoded_stdout.splitlines()
        if not first_line:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Frame materialization failed")
        version_parts = first_line[0].strip().split()
        if len(version_parts) < 3 or version_parts[0] != "ffmpeg" or version_parts[1] != "version":
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Frame materialization failed")
        self._cached_ffmpeg_version = version_parts[2]
        return self._cached_ffmpeg_version

    def _ensure_output_directory(self) -> Path:
        directory_failed = False
        output_directory: Path | None = None
        try:
            output_directory = ensure_workspace_directory(self.workspace_root, "frame-candidates")
        except MediaAdapterError:
            directory_failed = True
        except Exception:
            directory_failed = True
        if directory_failed or output_directory is None:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Frame output directory is invalid")
        return output_directory

    def _materialize_single_frame(
        self,
        *,
        video_path: Path,
        output_directory: Path,
        primary_video_stream_index: int,
        ffmpeg_version: str,
        request: FrameRequest,
    ) -> MaterializedFrame:
        final_path, partial_path = self._build_output_paths(output_directory)
        timestamp_seconds = f"{request.timestamp_ms / 1000:.6f}"
        command_args = [
            self.ffmpeg_path,
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-n",
            "-i",
            str(video_path),
            "-ss",
            timestamp_seconds,
            "-map",
            f"0:{primary_video_stream_index}",
            "-frames:v",
            "1",
            "-an",
            "-sn",
            "-dn",
            "-map_metadata",
            "-1",
            "-vf",
            f"scale={self.config.max_width}:-2:force_original_aspect_ratio=decrease",
            "-c:v",
            "png",
            "-f",
            "image2",
            "-fs",
            str(self.config.max_output_bytes),
            str(partial_path),
        ]

        command_code: str | None = None
        command_result = None
        try:
            raw_result = self.command_runner(
                command_args,
                timeout_seconds=self.config.timeout_seconds,
                max_stdout_bytes=self.config.max_stdout_bytes,
                max_stderr_bytes=self.config.max_stderr_bytes,
                cwd=self.workspace_root,
            )
            command_result = normalize_command_result(
                raw_result,
                max_stdout_bytes=self.config.max_stdout_bytes,
                max_stderr_bytes=self.config.max_stderr_bytes,
            )
        except MediaAdapterError as error:
            command_code = "FRAME_MATERIALIZE_TIMEOUT" if error.code == "MEDIA_SUBPROCESS_TIMEOUT" else "FRAME_MATERIALIZE_FAILED"
        except Exception:
            command_code = "FRAME_MATERIALIZE_FAILED"
        if command_code is not None:
            self._cleanup_paths(partial_path=partial_path, final_path=None)
            raise _stable_error(command_code, self._message_for_code(command_code))
        partial_exists_failed = False
        partial_exists = False
        try:
            partial_exists = partial_path.exists()
        except Exception:
            partial_exists_failed = True
        if (
            command_result is None
            or command_result.returncode != 0
            or partial_exists_failed
            or not partial_exists
        ):
            self._cleanup_paths(partial_path=partial_path, final_path=None)
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Frame materialization failed")

        verification = self._verify_partial_frame(partial_path)
        if verification is None:
            self._cleanup_paths(partial_path=partial_path, final_path=None)
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Frame materialization failed")
        if not self._publish_partial_output(partial_path, final_path):
            self._cleanup_paths(partial_path=partial_path, final_path=final_path)
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Frame materialization failed")

        finalize_failed = False
        try:
            sha256 = self._sha256_file(final_path)
            size_bytes = final_path.stat().st_size
        except Exception:
            finalize_failed = True
            sha256 = ""
            size_bytes = 0
        if finalize_failed or size_bytes > self.config.max_output_bytes:
            self._cleanup_paths(partial_path=None, final_path=final_path)
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Frame materialization failed")

        return MaterializedFrame(
            candidate_id=request.candidate_id,
            semantic_moment_id=request.semantic_moment_id,
            timestamp_ms=request.timestamp_ms,
            source_signal=request.source_signal,
            selection_reason=request.selection_reason,
            local_path=final_path,
            mime_type="image/png",
            size_bytes=size_bytes,
            sha256=sha256,
            width=verification["width"],
            height=verification["height"],
            ffmpeg_version=ffmpeg_version,
            frame_extractor_version=self.config.processor_version,
        )

    def _build_output_paths(self, output_directory: Path) -> tuple[Path, Path]:
        token_error = False
        token: str | None = None
        try:
            token = self.config.create_output_token()
        except Exception:
            token_error = True
        if token_error or not isinstance(token, str):
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Output token is invalid")
        uuid_error = False
        try:
            parsed_uuid = uuid.UUID(token)
        except ValueError:
            uuid_error = True
            parsed_uuid = None
        if uuid_error or parsed_uuid is None:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Output token is invalid")
        if parsed_uuid.version != 4 or str(parsed_uuid) != token or token != token.lower():
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Output token is invalid")

        path_failed = False
        try:
            final_path = (output_directory / f"{token}.png").resolve(strict=False)
            partial_path = (output_directory / f"{token}.png.partial").resolve(strict=False)
            final_exists = final_path.exists()
            partial_exists = partial_path.exists()
        except Exception:
            path_failed = True
            final_path = output_directory / f"{token}.png"
            partial_path = output_directory / f"{token}.png.partial"
            final_exists = False
            partial_exists = False
        if path_failed or final_path.parent != output_directory or partial_path.parent != output_directory:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Output path is invalid")
        if final_exists or partial_exists:
            raise _stable_error("FRAME_MATERIALIZE_FAILED", "Output path already exists")
        return final_path, partial_path

    def _verify_partial_frame(self, partial_path: Path) -> dict[str, int] | None:
        stat_failed = False
        try:
            size_bytes = partial_path.stat().st_size
        except Exception:
            stat_failed = True
            size_bytes = 0
        if stat_failed or size_bytes <= 0 or size_bytes > self.config.max_output_bytes:
            return None
        with _PIL_IMAGE_PIXELS_LOCK:
            previous_max_pixels = Image.MAX_IMAGE_PIXELS
            try:
                Image.MAX_IMAGE_PIXELS = self.config.max_image_pixels
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(partial_path) as image:
                        image.verify()
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(partial_path) as image:
                        image.load()
                        if image.format != "PNG":
                            return None
                        width, height = image.size
            except (OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
                return None
            finally:
                Image.MAX_IMAGE_PIXELS = previous_max_pixels
        if (
            width <= 0
            or height <= 0
            or width > self.config.max_width
            or width * height > self.config.max_image_pixels
        ):
            return None
        return {"width": width, "height": height}

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
            self._cleanup_paths(partial_path=None, final_path=final_path)
            return False
        return True

    def _sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while True:
                chunk = stream.read(64 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return digest.hexdigest()

    def _cleanup_paths(self, *, partial_path: Path | None, final_path: Path | None) -> None:
        for candidate in (partial_path, final_path):
            exists = False
            try:
                exists = candidate is not None and candidate.exists()
            except Exception:
                exists = False
            if candidate is None or not exists:
                continue
            try:
                candidate.unlink()
            except Exception:
                pass

    def _cleanup_batch_results(self, results: list[MaterializedFrame]) -> None:
        for result in results:
            self._cleanup_paths(partial_path=None, final_path=result.local_path)

    def _message_for_code(self, error_code: str) -> str:
        if error_code == "FRAME_MATERIALIZE_TIMEOUT":
            return "Frame materialization timed out"
        if error_code == "FRAME_VIDEO_TRACK_MISSING":
            return "Motion video track is missing"
        return "Frame materialization failed"
