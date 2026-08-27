from __future__ import annotations

import json
import math
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Literal

from .errors import MediaAdapterError
from .subprocess_support import (
    CommandRunner,
    ensure_workspace_file,
    normalize_command_result,
    run_command,
)


SourceKind = Literal["audio", "video"]
MAX_SAFE_INTEGER = 2**53 - 1
MAX_CODEC_STRING_LENGTH = 256
MAX_FORMAT_STRING_LENGTH = 512
MAX_SAMPLE_RATE = 768000
MAX_CHANNELS = 128
MAX_VIDEO_DIMENSION = 100000
MAX_SAFE_DURATION_SECONDS = MAX_SAFE_INTEGER / 1000


def _stable_error(code: str, message: str) -> MediaAdapterError:
    error = MediaAdapterError(code, message)
    error.__cause__ = None
    error.__context__ = None
    error.__suppress_context__ = True
    return error


def _is_safe_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_SAFE_INTEGER


def _positive_int(value: object, *, code: str, field_name: str, maximum: int = MAX_SAFE_INTEGER) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0 or value > maximum:
        raise _stable_error(code, f"{field_name} must be a positive integer")
    return value


def _positive_number(value: object, *, code: str, field_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _stable_error(code, f"{field_name} must be a positive number")
    numeric: float | None = None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        numeric = None
    if numeric is None:
        raise _stable_error(code, f"{field_name} must be a positive number")
    if not math.isfinite(numeric) or numeric <= 0:
        raise _stable_error(code, f"{field_name} must be a positive number")
    return numeric


def _safe_string(
    value: object,
    *,
    code: str,
    field_name: str,
    maximum_length: int,
) -> str:
    if not isinstance(value, str):
        raise _stable_error(code, f"{field_name} is invalid")
    if not value.strip() or len(value) > maximum_length or any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise _stable_error(code, f"{field_name} is invalid")
    return value


def _parse_int_string(value: str, *, code: str) -> int:
    parsed: int | None = None
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        parsed = None
    if parsed is None:
        raise _stable_error(code, "ffprobe returned invalid output")
    return parsed


@dataclass(frozen=True)
class MediaProbeResult:
    duration_ms: int
    format_name: str | None
    size_bytes: int | None
    bit_rate: int | None
    has_audio: bool
    has_video: bool
    primary_audio_stream_index: int | None
    primary_video_stream_index: int | None
    streams: list[dict[str, object]]
    ffprobe_version: str
    degradation: dict[str, str] | None

    def to_manifest(self) -> dict[str, object]:
        return {
            "durationMs": self.duration_ms,
            "formatName": self.format_name,
            "sizeBytes": self.size_bytes,
            "bitRate": self.bit_rate,
            "hasAudio": self.has_audio,
            "hasVideo": self.has_video,
            "primaryAudioStreamIndex": self.primary_audio_stream_index,
            "primaryVideoStreamIndex": self.primary_video_stream_index,
            "streams": self.streams,
            "ffprobeVersion": self.ffprobe_version,
            "degradation": self.degradation,
        }


class FfprobeAdapter:
    def __init__(
        self,
        *,
        workspace_root: Path,
        ffprobe_path: str = "ffprobe",
        command_runner: CommandRunner | None = None,
        timeout_seconds: float = 10.0,
        max_stdout_bytes: int = 1024 * 1024,
        max_stderr_bytes: int = 64 * 1024,
        max_duration_ms: int = 12 * 60 * 60 * 1000,
    ) -> None:
        if not isinstance(workspace_root, Path):
            raise _stable_error("MEDIA_PROBE_FAILED", "workspace_root must be a Path")
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
            raise _stable_error("MEDIA_PROBE_FAILED", "workspace_root is invalid")
        if not workspace_exists or not workspace_is_dir:
            raise _stable_error("MEDIA_PROBE_FAILED", "workspace_root is invalid")
        if not isinstance(ffprobe_path, str) or not ffprobe_path.strip():
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe_path is invalid")
        if command_runner is not None and not callable(command_runner):
            raise _stable_error("MEDIA_PROBE_FAILED", "command_runner must be callable")

        self.workspace_root = resolved_workspace
        self.ffprobe_path = ffprobe_path
        self.command_runner = command_runner or run_command
        self.timeout_seconds = _positive_number(
            timeout_seconds,
            code="MEDIA_PROBE_FAILED",
            field_name="timeout_seconds",
        )
        self.max_stdout_bytes = _positive_int(
            max_stdout_bytes,
            code="MEDIA_PROBE_FAILED",
            field_name="max_stdout_bytes",
        )
        self.max_stderr_bytes = _positive_int(
            max_stderr_bytes,
            code="MEDIA_PROBE_FAILED",
            field_name="max_stderr_bytes",
        )
        self.max_duration_ms = _positive_int(
            max_duration_ms,
            code="MEDIA_PROBE_FAILED",
            field_name="max_duration_ms",
        )
        self._cached_version: str | None = None

    def probe_media(self, input_path: Path, *, source_kind: SourceKind | None) -> MediaProbeResult:
        if source_kind not in {None, "audio", "video"}:
            raise _stable_error("MEDIA_PROBE_FAILED", "source_kind is invalid")
        resolved_input = ensure_workspace_file(
            self.workspace_root,
            input_path,
            error_code="MEDIA_PROBE_FAILED",
            error_message="Media input is not accessible",
        )
        ffprobe_version = self._get_ffprobe_version()
        probe_result = self._run_ffprobe(resolved_input)
        manifest = self._parse_probe_payload(probe_result["format"], probe_result["streams"])
        self._validate_source_kind(manifest, source_kind)
        return MediaProbeResult(
            duration_ms=manifest["durationMs"],
            format_name=manifest["formatName"],
            size_bytes=manifest["sizeBytes"],
            bit_rate=manifest["bitRate"],
            has_audio=manifest["hasAudio"],
            has_video=manifest["hasVideo"],
            primary_audio_stream_index=manifest["primaryAudioStreamIndex"],
            primary_video_stream_index=manifest["primaryVideoStreamIndex"],
            streams=manifest["streams"],
            ffprobe_version=ffprobe_version,
            degradation=manifest["degradation"],
        )

    def _get_ffprobe_version(self) -> str:
        if self._cached_version is not None:
            return self._cached_version
        command_error_code: str | None = None
        result = None
        try:
            raw_result = self.command_runner(
                [self.ffprobe_path, "-version"],
                timeout_seconds=self.timeout_seconds,
                max_stdout_bytes=self.max_stdout_bytes,
                max_stderr_bytes=self.max_stderr_bytes,
                cwd=self.workspace_root,
            )
            result = normalize_command_result(
                raw_result,
                max_stdout_bytes=self.max_stdout_bytes,
                max_stderr_bytes=self.max_stderr_bytes,
            )
        except MediaAdapterError as error:
            command_error_code = "MEDIA_PROBE_TIMEOUT" if error.code == "MEDIA_SUBPROCESS_TIMEOUT" else "MEDIA_PROBE_FAILED"
        except Exception:
            command_error_code = "MEDIA_PROBE_FAILED"
        if command_error_code is not None:
            message = "ffprobe timed out" if command_error_code == "MEDIA_PROBE_TIMEOUT" else "ffprobe is unavailable"
            raise _stable_error(command_error_code, message)
        if result is None or result.returncode != 0:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe is unavailable")
        decoded_stdout: str | None = None
        try:
            decoded_stdout = result.stdout.decode("utf-8")
        except UnicodeDecodeError:
            decoded_stdout = None
        if decoded_stdout is None:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe is unavailable")
        first_line = decoded_stdout.splitlines()
        if not first_line:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe is unavailable")
        version_tokens = first_line[0].strip().split()
        if len(version_tokens) < 3 or version_tokens[0] != "ffprobe" or version_tokens[1] != "version":
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe is unavailable")
        self._cached_version = version_tokens[2]
        return self._cached_version

    def _run_ffprobe(self, input_path: Path) -> dict[str, object]:
        command_error_code: str | None = None
        result = None
        try:
            raw_result = self.command_runner(
                [
                    self.ffprobe_path,
                    "-hide_banner",
                    "-v",
                    "error",
                    "-print_format",
                    "json",
                    "-show_format",
                    "-show_streams",
                    "-show_chapters",
                    "--",
                    str(input_path),
                ],
                timeout_seconds=self.timeout_seconds,
                max_stdout_bytes=self.max_stdout_bytes,
                max_stderr_bytes=self.max_stderr_bytes,
                cwd=self.workspace_root,
            )
            result = normalize_command_result(
                raw_result,
                max_stdout_bytes=self.max_stdout_bytes,
                max_stderr_bytes=self.max_stderr_bytes,
            )
        except MediaAdapterError as error:
            command_error_code = "MEDIA_PROBE_TIMEOUT" if error.code == "MEDIA_SUBPROCESS_TIMEOUT" else "MEDIA_PROBE_FAILED"
        except Exception:
            command_error_code = "MEDIA_PROBE_FAILED"
        if command_error_code is not None:
            message = "ffprobe timed out" if command_error_code == "MEDIA_PROBE_TIMEOUT" else "ffprobe failed"
            raise _stable_error(command_error_code, message)
        if result is None or result.returncode != 0:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe failed")
        payload: object | None = None
        try:
            payload = json.loads(result.stdout.decode("utf-8"))
        except Exception:
            payload = None
        if payload is None:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        if not isinstance(payload, dict):
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        format_section = payload.get("format")
        streams = payload.get("streams")
        if not isinstance(format_section, dict) or not isinstance(streams, list):
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        return {"format": format_section, "streams": streams}

    def _parse_probe_payload(
        self,
        format_section: dict[str, object],
        streams_payload: list[object],
    ) -> dict[str, object]:
        parsed_streams: list[dict[str, object]] = []
        seen_indices: set[int] = set()
        fallback_durations_ms: list[int] = []
        audio_streams: list[dict[str, object]] = []
        video_streams: list[dict[str, object]] = []

        for stream in streams_payload:
            parsed_stream = self._parse_stream(stream)
            index = parsed_stream["index"]
            if index in seen_indices:
                raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
            seen_indices.add(index)
            parsed_streams.append(parsed_stream)
            codec_type = parsed_stream["codecType"]
            duration_ms = parsed_stream["durationMs"]
            if codec_type == "audio":
                audio_streams.append(parsed_stream)
                if duration_ms is not None:
                    fallback_durations_ms.append(duration_ms)
            if codec_type == "video" and parsed_stream["disposition"]["attachedPic"] is False:
                video_streams.append(parsed_stream)
                if duration_ms is not None:
                    fallback_durations_ms.append(duration_ms)

        duration_ms = self._parse_duration_ms(format_section.get("duration"))
        if duration_ms is None:
            if not fallback_durations_ms:
                raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media duration is unavailable")
            duration_ms = max(fallback_durations_ms)
        if duration_ms > self.max_duration_ms:
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media duration exceeds supported limits")

        primary_audio_stream_index = self._primary_stream_index(audio_streams)
        primary_video_stream_index = self._primary_stream_index(video_streams)
        has_audio = bool(audio_streams)
        has_video = bool(video_streams)
        degradation = None
        if has_video and not has_audio:
            degradation = {"mode": "visual_only", "reason": "no_audio_track"}

        return {
            "durationMs": duration_ms,
            "formatName": self._optional_string(format_section.get("format_name"), maximum_length=MAX_FORMAT_STRING_LENGTH),
            "sizeBytes": self._optional_nonnegative_int(format_section.get("size")),
            "bitRate": self._optional_nonnegative_int(format_section.get("bit_rate")),
            "hasAudio": has_audio,
            "hasVideo": has_video,
            "primaryAudioStreamIndex": primary_audio_stream_index,
            "primaryVideoStreamIndex": primary_video_stream_index,
            "streams": parsed_streams,
            "degradation": degradation,
        }

    def _validate_source_kind(self, manifest: dict[str, object], source_kind: SourceKind | None) -> None:
        has_audio = manifest["hasAudio"] is True
        has_video = manifest["hasVideo"] is True
        if source_kind == "audio" and (not has_audio or has_video):
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Audio source is incompatible")
        if source_kind == "video" and not has_video:
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Video source is incompatible")

    def _parse_stream(self, stream: object) -> dict[str, object]:
        if not isinstance(stream, dict):
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        index = stream.get("index")
        if not _is_safe_integer(index):
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        codec_type = stream.get("codec_type")
        codec_name = stream.get("codec_name")
        codec_type_value = _safe_string(
            codec_type,
            code="MEDIA_PROBE_FAILED",
            field_name="codec_type",
            maximum_length=32,
        )
        codec_name_value = _safe_string(
            codec_name,
            code="MEDIA_PROBE_FAILED",
            field_name="codec_name",
            maximum_length=MAX_CODEC_STRING_LENGTH,
        )
        if codec_type_value not in {"audio", "video", "subtitle", "data"}:
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media stream is unsupported")
        disposition_payload = stream.get("disposition", {})
        if not isinstance(disposition_payload, dict):
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        disposition = {
            "default": self._parse_disposition_flag(disposition_payload.get("default", 0)),
            "attachedPic": self._parse_disposition_flag(disposition_payload.get("attached_pic", 0)),
        }
        parsed_stream: dict[str, object] = {
            "index": index,
            "codecType": codec_type_value,
            "codecName": codec_name_value,
            "durationMs": self._parse_duration_ms(stream.get("duration")),
            "timeBase": self._optional_string(stream.get("time_base"), maximum_length=64),
            "disposition": disposition,
        }
        if parsed_stream["durationMs"] is not None and parsed_stream["durationMs"] > self.max_duration_ms:
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media duration exceeds supported limits")
        if codec_type_value == "audio":
            sample_rate = self._required_positive_int(stream.get("sample_rate"), maximum=MAX_SAMPLE_RATE)
            channels = self._required_positive_int(stream.get("channels"), maximum=MAX_CHANNELS)
            parsed_stream["audio"] = {
                "sampleRate": sample_rate,
                "channels": channels,
                "channelLayout": self._optional_string(stream.get("channel_layout"), maximum_length=128),
            }
        if codec_type_value == "video":
            width = self._required_positive_int(stream.get("width"), maximum=MAX_VIDEO_DIMENSION)
            height = self._required_positive_int(stream.get("height"), maximum=MAX_VIDEO_DIMENSION)
            parsed_stream["video"] = {
                "width": width,
                "height": height,
                "avgFrameRate": self._optional_frame_rate(stream.get("avg_frame_rate")),
            }
        return parsed_stream

    def _parse_disposition_flag(self, value: object) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, int) and value in (0, 1):
            return bool(value)
        raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")

    def _parse_duration_ms(self, value: object) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool):
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media duration is invalid")
        numeric: float | None = None
        if isinstance(value, (int, float)):
            try:
                numeric = float(value)
            except (TypeError, ValueError, OverflowError):
                numeric = None
        elif isinstance(value, str):
            if any(ord(character) < 32 or ord(character) == 127 for character in value):
                raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media duration is invalid")
            try:
                numeric = float(value)
            except (TypeError, ValueError, OverflowError):
                numeric = None
        else:
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media duration is invalid")
        if numeric is None or not math.isfinite(numeric) or numeric < 0 or numeric > MAX_SAFE_DURATION_SECONDS:
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media duration is invalid")
        duration_ms: int | None = None
        try:
            duration_ms = round(numeric * 1000)
        except (TypeError, ValueError, OverflowError):
            duration_ms = None
        if duration_ms is None:
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media duration is invalid")
        if duration_ms < 0 or duration_ms > MAX_SAFE_INTEGER:
            raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media duration is invalid")
        return duration_ms

    def _optional_string(self, value: object, *, maximum_length: int) -> str | None:
        if value is None:
            return None
        return _safe_string(
            value,
            code="MEDIA_PROBE_FAILED",
            field_name="string",
            maximum_length=maximum_length,
        )

    def _optional_nonnegative_int(self, value: object) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool):
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        if isinstance(value, int):
            parsed = value
        elif isinstance(value, str):
            if any(ord(character) < 32 or ord(character) == 127 for character in value):
                raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
            parsed = _parse_int_string(value, code="MEDIA_PROBE_FAILED")
        else:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        if parsed < 0 or parsed > MAX_SAFE_INTEGER:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        return parsed

    def _required_positive_int(self, value: object, *, maximum: int) -> int:
        if isinstance(value, bool):
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        if isinstance(value, int):
            parsed = value
        elif isinstance(value, str):
            if any(ord(character) < 32 or ord(character) == 127 for character in value):
                raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
            parsed = _parse_int_string(value, code="MEDIA_PROBE_FAILED")
        else:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        if parsed <= 0 or parsed > maximum:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        return parsed

    def _optional_frame_rate(self, value: object) -> float | None:
        if value is None:
            return None
        frame_rate_value = _safe_string(
            value,
            code="MEDIA_PROBE_FAILED",
            field_name="avg_frame_rate",
            maximum_length=64,
        )
        numerator, separator, denominator = frame_rate_value.partition("/")
        if separator:
            numerator_value: int | None = None
            denominator_value: int | None = None
            try:
                numerator_value = int(numerator)
                denominator_value = int(denominator)
            except (TypeError, ValueError, OverflowError):
                numerator_value = None
                denominator_value = None
            if numerator_value is None or denominator_value is None:
                raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
            if denominator_value == 0:
                if numerator_value == 0:
                    return None
                raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
            fraction: Fraction | None = None
            try:
                fraction = Fraction(numerator_value, denominator_value)
            except (TypeError, ValueError, ZeroDivisionError, OverflowError):
                fraction = None
            if fraction is None:
                raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
            if fraction <= 0:
                return None
            return float(fraction)
        frame_rate: float | None = None
        try:
            frame_rate = float(frame_rate_value)
        except (TypeError, ValueError, OverflowError):
            frame_rate = None
        if frame_rate is None:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        if not math.isfinite(frame_rate) or frame_rate <= 0:
            raise _stable_error("MEDIA_PROBE_FAILED", "ffprobe returned invalid output")
        return frame_rate

    def _primary_stream_index(self, streams: list[dict[str, object]]) -> int | None:
        if not streams:
            return None
        for stream in streams:
            if stream["disposition"]["default"] is True:
                return stream["index"]
        return streams[0]["index"]
