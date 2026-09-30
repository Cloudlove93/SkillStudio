from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import MediaAdapterError
from .subprocess_support import (
    CommandRunner,
    ensure_workspace_file,
    normalize_command_result,
    run_command,
)


MAX_SAFE_INTEGER = 2**53 - 1
MAX_PROCESSOR_VERSION_LENGTH = 128
MAX_ALGORITHM_LENGTH = 128
MAX_ALLOWED_SAMPLE_WIDTH = 320
MAX_ALLOWED_SAMPLE_HEIGHT = 180
MAX_ALLOWED_SAMPLE_COUNT = 600
MAX_ALLOWED_SIGNAL_COUNT = 128
MAX_ALLOWED_MARGIN_BYTES = 64 * 1024
MAX_TIMEOUT_SECONDS = 600
MAX_STDERR_BYTES = 4 * 1024 * 1024
PTS_TIME_PATTERN = re.compile(
    r"(?:^|[\r\n])\[Parsed_showinfo_[^\]]+\][^\r\n]*pts_time:([0-9]+(?:\.[0-9]+)?)",
)


def _stable_error(code: str, message: str) -> MediaAdapterError:
    error = MediaAdapterError(code, message)
    error.__cause__ = None
    error.__context__ = None
    error.__suppress_context__ = True
    return error


def _positive_int(
    value: object,
    *,
    field_name: str,
    maximum: int,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > maximum:
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", f"{field_name} must be a positive integer")
    return value


def _ratio(value: object, *, field_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", f"{field_name} must be a finite number")
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < 0 or numeric > 1:
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", f"{field_name} must be between 0 and 1")
    return numeric


def _positive_number(value: object, *, field_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", f"{field_name} must be a positive number")
    numeric = float(value)
    if not math.isfinite(numeric) or numeric <= 0 or numeric > MAX_TIMEOUT_SECONDS:
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", f"{field_name} must be a positive number")
    return numeric


def _safe_text(value: object, *, field_name: str, maximum_length: int) -> str:
    if not isinstance(value, str):
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", f"{field_name} is invalid")
    if (
        not value.strip()
        or len(value) > maximum_length
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", f"{field_name} is invalid")
    return value


def _probe_bool(probe_result: object, attribute: str) -> bool:
    try:
        value = getattr(probe_result, attribute)
    except Exception:
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Video probe is invalid")
    if not isinstance(value, bool):
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Video probe is invalid")
    return value


def _probe_int(probe_result: object, attribute: str, *, minimum: int) -> int:
    try:
        value = getattr(probe_result, attribute)
    except Exception:
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Video probe is invalid")
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > MAX_SAFE_INTEGER:
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Video probe is invalid")
    return value


def _frame_difference(left: bytes, right: bytes) -> float:
    if len(left) != len(right) or len(left) == 0:
        raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Visual signal output was invalid")
    diff_sum = 0
    for left_value, right_value in zip(left, right):
        diff_sum += abs(left_value - right_value)
    return diff_sum / (255.0 * len(left))


@dataclass(frozen=True)
class VisualSignalDetectorConfig:
    processor_version: str
    algorithm: str
    sample_width: int
    sample_height: int
    min_sample_interval_ms: int
    max_samples: int
    max_scene_signals: int
    max_slow_signals: int
    min_signal_spacing_ms: int
    scene_change_threshold: float
    slow_change_max_step_threshold: float
    slow_change_accum_threshold: float
    slow_change_min_run_samples: int
    timeout_seconds: float
    max_stdout_bytes_margin: int
    max_stderr_bytes: int

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "processor_version",
            _safe_text(
                self.processor_version,
                field_name="processor_version",
                maximum_length=MAX_PROCESSOR_VERSION_LENGTH,
            ),
        )
        object.__setattr__(
            self,
            "algorithm",
            _safe_text(
                self.algorithm,
                field_name="algorithm",
                maximum_length=MAX_ALGORITHM_LENGTH,
            ),
        )
        object.__setattr__(
            self,
            "sample_width",
            _positive_int(
                self.sample_width,
                field_name="sample_width",
                maximum=MAX_ALLOWED_SAMPLE_WIDTH,
            ),
        )
        object.__setattr__(
            self,
            "sample_height",
            _positive_int(
                self.sample_height,
                field_name="sample_height",
                maximum=MAX_ALLOWED_SAMPLE_HEIGHT,
            ),
        )
        object.__setattr__(
            self,
            "min_sample_interval_ms",
            _positive_int(
                self.min_sample_interval_ms,
                field_name="min_sample_interval_ms",
                maximum=MAX_SAFE_INTEGER,
            ),
        )
        object.__setattr__(
            self,
            "max_samples",
            _positive_int(
                self.max_samples,
                field_name="max_samples",
                maximum=MAX_ALLOWED_SAMPLE_COUNT,
            ),
        )
        object.__setattr__(
            self,
            "max_scene_signals",
            _positive_int(
                self.max_scene_signals,
                field_name="max_scene_signals",
                maximum=MAX_ALLOWED_SIGNAL_COUNT,
            ),
        )
        object.__setattr__(
            self,
            "max_slow_signals",
            _positive_int(
                self.max_slow_signals,
                field_name="max_slow_signals",
                maximum=MAX_ALLOWED_SIGNAL_COUNT,
            ),
        )
        object.__setattr__(
            self,
            "min_signal_spacing_ms",
            _positive_int(
                self.min_signal_spacing_ms,
                field_name="min_signal_spacing_ms",
                maximum=MAX_SAFE_INTEGER,
            ),
        )
        object.__setattr__(
            self,
            "scene_change_threshold",
            _ratio(self.scene_change_threshold, field_name="scene_change_threshold"),
        )
        object.__setattr__(
            self,
            "slow_change_max_step_threshold",
            _ratio(
                self.slow_change_max_step_threshold,
                field_name="slow_change_max_step_threshold",
            ),
        )
        object.__setattr__(
            self,
            "slow_change_accum_threshold",
            _ratio(self.slow_change_accum_threshold, field_name="slow_change_accum_threshold"),
        )
        object.__setattr__(
            self,
            "slow_change_min_run_samples",
            _positive_int(
                self.slow_change_min_run_samples,
                field_name="slow_change_min_run_samples",
                maximum=self.max_samples,
            ),
        )
        object.__setattr__(
            self,
            "timeout_seconds",
            _positive_number(self.timeout_seconds, field_name="timeout_seconds"),
        )
        object.__setattr__(
            self,
            "max_stdout_bytes_margin",
            _positive_int(
                self.max_stdout_bytes_margin,
                field_name="max_stdout_bytes_margin",
                maximum=MAX_ALLOWED_MARGIN_BYTES,
            ),
        )
        object.__setattr__(
            self,
            "max_stderr_bytes",
            _positive_int(
                self.max_stderr_bytes,
                field_name="max_stderr_bytes",
                maximum=MAX_STDERR_BYTES,
            ),
        )
        if self.slow_change_max_step_threshold >= self.scene_change_threshold:
            raise _stable_error(
                "VISUAL_SIGNAL_DETECT_FAILED",
                "slow_change_max_step_threshold must be lower than scene_change_threshold",
            )


@dataclass(frozen=True)
class VisualSignalDetectionResult:
    processor_version: str
    algorithm: str
    config: dict[str, object]
    scene_change_timestamps_ms: list[int]
    slow_visual_change_timestamps_ms: list[int]
    sampled_frame_count: int
    degradations: list[dict[str, str]]
    ffmpeg_version: str

    def to_manifest(self) -> dict[str, object]:
        return {
            "processorVersion": self.processor_version,
            "algorithm": self.algorithm,
            "config": self.config,
            "sceneChangeTimestampsMs": self.scene_change_timestamps_ms,
            "slowVisualChangeTimestampsMs": self.slow_visual_change_timestamps_ms,
            "sampledFrameCount": self.sampled_frame_count,
            "degradations": self.degradations,
            "ffmpegVersion": self.ffmpeg_version,
        }


class VisualSignalDetector:
    def __init__(
        self,
        *,
        workspace_root: Path,
        config: VisualSignalDetectorConfig,
        ffmpeg_path: str = "ffmpeg",
        command_runner: CommandRunner | None = None,
    ) -> None:
        if not isinstance(workspace_root, Path):
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "workspace_root must be a Path")
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
        if workspace_error or not workspace_exists or not workspace_is_dir:
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "workspace_root is invalid")
        if not isinstance(ffmpeg_path, str) or not ffmpeg_path.strip():
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "ffmpeg_path is invalid")
        if command_runner is not None and not callable(command_runner):
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "command_runner must be callable")
        if not isinstance(config, VisualSignalDetectorConfig):
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "config is invalid")

        self.workspace_root = resolved_workspace
        self.config = config
        self.ffmpeg_path = ffmpeg_path
        self.command_runner = command_runner or run_command
        self._cached_version: str | None = None

    def detect_signals(
        self,
        input_path: Path,
        probe_result: object,
    ) -> VisualSignalDetectionResult:
        resolved_input = ensure_workspace_file(
            self.workspace_root,
            input_path,
            error_code="VISUAL_SIGNAL_DETECT_FAILED",
            error_message="Video input is not accessible",
        )
        duration_ms = _probe_int(probe_result, "duration_ms", minimum=1)
        has_video = _probe_bool(probe_result, "has_video")
        if not has_video:
            raise _stable_error("VISUAL_SIGNAL_VIDEO_TRACK_MISSING", "Video track is missing")
        primary_video_stream_index = _probe_int(
            probe_result,
            "primary_video_stream_index",
            minimum=0,
        )

        ffmpeg_version = self._get_ffmpeg_version()
        sample_interval_ms = max(
            self.config.min_sample_interval_ms,
            math.ceil(duration_ms / self.config.max_samples),
        )
        target_sample_count = min(
            self.config.max_samples,
            max(1, math.ceil(duration_ms / sample_interval_ms)),
        )
        frame_bytes = self.config.sample_width * self.config.sample_height
        stdout_limit = frame_bytes * target_sample_count + self.config.max_stdout_bytes_margin
        interval_seconds = sample_interval_ms / 1000
        filter_graph = (
            f"fps=1/{interval_seconds:.3f},"
            f"scale={self.config.sample_width}:{self.config.sample_height}:flags=area,"
            "format=gray,showinfo"
        )

        command_error_code: str | None = None
        command_result = None
        try:
            raw_result = self.command_runner(
                [
                    self.ffmpeg_path,
                    "-hide_banner",
                    "-nostdin",
                    "-v",
                    "info",
                    "-i",
                    str(resolved_input),
                    "-map",
                    f"0:{primary_video_stream_index}",
                    "-an",
                    "-sn",
                    "-dn",
                    "-vf",
                    filter_graph,
                    "-frames:v",
                    str(target_sample_count),
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "gray",
                    "-",
                ],
                timeout_seconds=self.config.timeout_seconds,
                max_stdout_bytes=stdout_limit,
                max_stderr_bytes=self.config.max_stderr_bytes,
                cwd=self.workspace_root,
            )
            command_result = normalize_command_result(
                raw_result,
                max_stdout_bytes=stdout_limit,
                max_stderr_bytes=self.config.max_stderr_bytes,
            )
        except MediaAdapterError as error:
            command_error_code = (
                "VISUAL_SIGNAL_DETECT_TIMEOUT"
                if error.code == "MEDIA_SUBPROCESS_TIMEOUT"
                else "VISUAL_SIGNAL_DETECT_FAILED"
            )
        except Exception:
            command_error_code = "VISUAL_SIGNAL_DETECT_FAILED"
        if command_error_code is not None:
            message = (
                "Visual signal detection timed out"
                if command_error_code == "VISUAL_SIGNAL_DETECT_TIMEOUT"
                else "Visual signal detection failed"
            )
            raise _stable_error(command_error_code, message)
        if command_result is None or command_result.returncode != 0:
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Visual signal detection failed")

        timestamps_ms = self._parse_showinfo_timestamps(command_result.stderr, duration_ms)
        if len(command_result.stdout) % frame_bytes != 0:
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Visual signal output was invalid")

        frames = [
            command_result.stdout[index : index + frame_bytes]
            for index in range(0, len(command_result.stdout), frame_bytes)
        ]
        if len(frames) > target_sample_count:
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Visual signal output was invalid")
        if len(timestamps_ms) != len(frames):
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Visual signal output was invalid")
        if len(frames) == 0:
            return VisualSignalDetectionResult(
                processor_version=self.config.processor_version,
                algorithm=self.config.algorithm,
                config=self._config_manifest(sample_interval_ms),
                scene_change_timestamps_ms=[],
                slow_visual_change_timestamps_ms=[],
                sampled_frame_count=0,
                degradations=[
                    {
                        "code": "NO_VISUAL_SAMPLES",
                        "message": "No video samples were extracted from the source stream",
                    }
                ],
                ffmpeg_version=ffmpeg_version,
            )

        scene_change_timestamps_ms: list[int] = []
        slow_visual_change_timestamps_ms: list[int] = []
        baseline_frame = frames[0]
        previous_frame = frames[0]
        consecutive_slow_steps = 0

        for frame_index in range(1, len(frames)):
            timestamp_ms = timestamps_ms[frame_index]
            current_frame = frames[frame_index]
            previous_delta = _frame_difference(previous_frame, current_frame)
            if previous_delta >= self.config.scene_change_threshold:
                self._append_signal(
                    scene_change_timestamps_ms,
                    timestamp_ms,
                    maximum=self.config.max_scene_signals,
                )
                baseline_frame = current_frame
                previous_frame = current_frame
                consecutive_slow_steps = 0
                continue

            if 0 < previous_delta <= self.config.slow_change_max_step_threshold:
                consecutive_slow_steps += 1
            else:
                baseline_frame = current_frame
                consecutive_slow_steps = 0
                previous_frame = current_frame
                continue

            baseline_delta = _frame_difference(baseline_frame, current_frame)
            if (
                consecutive_slow_steps >= self.config.slow_change_min_run_samples
                and baseline_delta >= self.config.slow_change_accum_threshold
            ):
                self._append_signal(
                    slow_visual_change_timestamps_ms,
                    timestamp_ms,
                    maximum=self.config.max_slow_signals,
                )
                baseline_frame = current_frame
                consecutive_slow_steps = 0

            previous_frame = current_frame

        return VisualSignalDetectionResult(
            processor_version=self.config.processor_version,
            algorithm=self.config.algorithm,
            config=self._config_manifest(sample_interval_ms),
            scene_change_timestamps_ms=scene_change_timestamps_ms,
            slow_visual_change_timestamps_ms=slow_visual_change_timestamps_ms,
            sampled_frame_count=len(frames),
            degradations=[],
            ffmpeg_version=ffmpeg_version,
        )

    def _get_ffmpeg_version(self) -> str:
        if self._cached_version is not None:
            return self._cached_version
        result = None
        command_error_code: str | None = None
        try:
            raw_result = self.command_runner(
                [self.ffmpeg_path, "-version"],
                timeout_seconds=self.config.timeout_seconds,
                max_stdout_bytes=64 * 1024,
                max_stderr_bytes=self.config.max_stderr_bytes,
                cwd=self.workspace_root,
            )
            result = normalize_command_result(
                raw_result,
                max_stdout_bytes=64 * 1024,
                max_stderr_bytes=self.config.max_stderr_bytes,
            )
        except MediaAdapterError as error:
            command_error_code = (
                "VISUAL_SIGNAL_DETECT_TIMEOUT"
                if error.code == "MEDIA_SUBPROCESS_TIMEOUT"
                else "VISUAL_SIGNAL_DETECT_FAILED"
            )
        except Exception:
            command_error_code = "VISUAL_SIGNAL_DETECT_FAILED"
        if command_error_code is not None:
            message = (
                "ffmpeg timed out"
                if command_error_code == "VISUAL_SIGNAL_DETECT_TIMEOUT"
                else "ffmpeg is unavailable"
            )
            raise _stable_error(command_error_code, message)
        if result is None or result.returncode != 0:
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "ffmpeg is unavailable")
        decoded_stdout: str | None = None
        try:
            decoded_stdout = result.stdout.decode("utf-8")
        except UnicodeDecodeError:
            decoded_stdout = None
        if decoded_stdout is None:
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "ffmpeg is unavailable")
        first_line = decoded_stdout.splitlines()
        if not first_line:
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "ffmpeg is unavailable")
        version_tokens = first_line[0].strip().split()
        if len(version_tokens) < 3 or version_tokens[0] != "ffmpeg" or version_tokens[1] != "version":
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "ffmpeg is unavailable")
        self._cached_version = version_tokens[2]
        return self._cached_version

    def _parse_showinfo_timestamps(
        self,
        stderr: bytes,
        duration_ms: int,
    ) -> list[int]:
        try:
            decoded_stderr = stderr.decode("utf-8")
        except UnicodeDecodeError:
            raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Visual signal output was invalid")
        timestamps_ms: list[int] = []
        for match in PTS_TIME_PATTERN.finditer(decoded_stderr):
            try:
                numeric = float(match.group(1))
            except (TypeError, ValueError, OverflowError):
                raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Visual signal output was invalid")
            if not math.isfinite(numeric) or numeric < 0:
                raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Visual signal output was invalid")
            timestamp_ms = int(round(numeric * 1000))
            if timestamp_ms >= duration_ms:
                timestamp_ms = duration_ms - 1
            timestamps_ms.append(timestamp_ms)
        for earlier, later in zip(timestamps_ms, timestamps_ms[1:]):
            if later < earlier:
                raise _stable_error("VISUAL_SIGNAL_DETECT_FAILED", "Visual signal output was invalid")
        return timestamps_ms

    def _append_signal(self, target: list[int], timestamp_ms: int, *, maximum: int) -> None:
        if len(target) >= maximum:
            return
        if target and timestamp_ms - target[-1] < self.config.min_signal_spacing_ms:
            return
        target.append(timestamp_ms)

    def _config_manifest(self, sample_interval_ms: int) -> dict[str, object]:
        return {
            "sampleIntervalMs": sample_interval_ms,
            "sampleWidth": self.config.sample_width,
            "sampleHeight": self.config.sample_height,
            "maxSamples": self.config.max_samples,
            "maxSceneSignals": self.config.max_scene_signals,
            "maxSlowSignals": self.config.max_slow_signals,
            "minSignalSpacingMs": self.config.min_signal_spacing_ms,
            "sceneChangeThreshold": self.config.scene_change_threshold,
            "slowChangeMaxStepThreshold": self.config.slow_change_max_step_threshold,
            "slowChangeAccumThreshold": self.config.slow_change_accum_threshold,
            "slowChangeMinRunSamples": self.config.slow_change_min_run_samples,
        }
