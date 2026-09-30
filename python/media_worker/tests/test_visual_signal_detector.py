from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from media_worker.errors import MediaAdapterError
from media_worker.ffprobe_adapter import FfprobeAdapter
from media_worker.visual_signal_detector import (
    VisualSignalDetectionResult,
    VisualSignalDetector,
    VisualSignalDetectorConfig,
)


def make_config(**overrides: object) -> VisualSignalDetectorConfig:
    config_kwargs = {
        "processor_version": "visual-signal-detector-v1",
        "algorithm": "gray_diff_scene_and_slow_change_bounded_steps_v2",
        "sample_width": 20,
        "sample_height": 10,
        "min_sample_interval_ms": 100,
        "max_samples": 12,
        "max_scene_signals": 6,
        "max_slow_signals": 6,
        "min_signal_spacing_ms": 120,
        "scene_change_threshold": 0.45,
        "slow_change_max_step_threshold": 0.02,
        "slow_change_accum_threshold": 0.08,
        "slow_change_min_run_samples": 2,
        "timeout_seconds": 5.0,
        "max_stdout_bytes_margin": 256,
        "max_stderr_bytes": 32 * 1024,
    }
    config_kwargs.update(overrides)
    return VisualSignalDetectorConfig(**config_kwargs)


def make_probe_result(
    *,
    duration_ms: int = 1000,
    has_video: bool = True,
    primary_video_stream_index: int = 0,
) -> object:
    return SimpleNamespace(
        duration_ms=duration_ms,
        has_video=has_video,
        primary_video_stream_index=primary_video_stream_index,
    )


def frame_bytes(width: int, height: int, value: int) -> bytes:
    return bytes([value]) * (width * height)


def board_frame(width: int, height: int, white_pixels: int) -> bytes:
    total = width * height
    white = max(0, min(total, white_pixels))
    return bytes([255]) * white + bytes([0]) * (total - white)


def raw_output(frames: list[bytes]) -> bytes:
    return b"".join(frames)


def showinfo_stderr(timestamps_ms: list[int]) -> bytes:
    lines = [
        f"[Parsed_showinfo_0 @ 00000000] n:{index} pts:{timestamp} pts_time:{timestamp/1000:.3f}"
        for index, timestamp in enumerate(timestamps_ms)
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def test_visual_signal_detector_parses_showinfo_after_ffmpeg_carriage_return(
    tmp_path: Path,
) -> None:
    video_path = tmp_path / "lesson.mp4"
    write_fake_video(video_path)
    config = make_config()
    width = config.sample_width
    height = config.sample_height

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        frames = [frame_bytes(width, height, value) for value in (0, 0, 255)]
        stderr = (
            b"[Parsed_showinfo_0 @ 00000000] n:0 pts:0 pts_time:0.000\n"
            b"frame=1 fps=0.0\r"
            b"[Parsed_showinfo_0 @ 00000000] n:1 pts:100 pts_time:0.100\r"
            b"[Parsed_showinfo_0 @ 00000000] n:2 pts:200 pts_time:0.200\n"
        )
        return {
            "stdout": raw_output(frames),
            "stderr": stderr,
            "returncode": 0,
        }

    result = VisualSignalDetector(
        workspace_root=tmp_path,
        config=config,
        command_runner=runner,
    ).detect_signals(video_path, make_probe_result(duration_ms=300))

    assert result.sampled_frame_count == 3
    assert result.scene_change_timestamps_ms == [200]


def stable_error_parts(error: MediaAdapterError) -> tuple[str | None, str | None]:
    return repr(error.__cause__), repr(error.__context__)


def write_fake_video(path: Path) -> None:
    path.write_bytes(b"fake-video")


def test_visual_signal_detector_rejects_invalid_configuration_probe_and_paths(
    tmp_path: Path,
) -> None:
    with pytest.raises(MediaAdapterError, match="VISUAL_SIGNAL_DETECT_FAILED"):
        VisualSignalDetector(workspace_root=tmp_path, config=make_config(max_samples=True))
    with pytest.raises(MediaAdapterError, match="VISUAL_SIGNAL_DETECT_FAILED"):
        VisualSignalDetector(workspace_root=tmp_path, config=make_config(timeout_seconds=float("nan")))
    with pytest.raises(MediaAdapterError, match="VISUAL_SIGNAL_DETECT_FAILED"):
        VisualSignalDetector(workspace_root=tmp_path, config=make_config(timeout_seconds=601))
    with pytest.raises(MediaAdapterError, match="VISUAL_SIGNAL_DETECT_FAILED"):
        VisualSignalDetector(workspace_root=tmp_path, config=make_config(max_samples=601))
    with pytest.raises(MediaAdapterError, match="VISUAL_SIGNAL_DETECT_FAILED"):
        VisualSignalDetector(workspace_root=tmp_path, config=make_config(max_stdout_bytes_margin=0))
    with pytest.raises(MediaAdapterError, match="VISUAL_SIGNAL_DETECT_FAILED"):
        VisualSignalDetector(workspace_root=tmp_path, config=make_config(max_stderr_bytes=4 * 1024 * 1024 + 1))

    detector = VisualSignalDetector(workspace_root=tmp_path, config=make_config())
    video_path = tmp_path / "lesson.mp4"
    write_fake_video(video_path)

    with pytest.raises(MediaAdapterError) as error_info:
        detector.detect_signals(video_path, make_probe_result(has_video=False))
    assert error_info.value.code == "VISUAL_SIGNAL_VIDEO_TRACK_MISSING"
    assert stable_error_parts(error_info.value) == ("None", "None")

    outside = tmp_path.parent / "outside.mp4"
    outside.write_bytes(b"outside")
    with pytest.raises(MediaAdapterError) as error_info:
        detector.detect_signals(outside, make_probe_result())
    assert error_info.value.code == "VISUAL_SIGNAL_DETECT_FAILED"

    symlink_path = tmp_path / "linked.mp4"
    try:
        symlink_path.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("symlink creation not available")
    with pytest.raises(MediaAdapterError) as error_info:
        detector.detect_signals(symlink_path, make_probe_result())
    assert error_info.value.code == "VISUAL_SIGNAL_DETECT_FAILED"


def test_visual_signal_detector_detects_stable_scene_and_slow_change_signals(
    tmp_path: Path,
) -> None:
    video_path = tmp_path / "lesson.mp4"
    write_fake_video(video_path)
    config = make_config()
    width = config.sample_width
    height = config.sample_height
    calls: list[list[str]] = []

    def stable_runner(args: list[str], **_: object):
        calls.append(args)
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        timestamps = [0, 100, 200, 300]
        frames = [frame_bytes(width, height, 0) for _ in timestamps]
        return {
            "stdout": raw_output(frames),
            "stderr": showinfo_stderr(timestamps),
            "returncode": 0,
        }

    detector = VisualSignalDetector(
        workspace_root=tmp_path,
        config=config,
        command_runner=stable_runner,
    )
    stable_result = detector.detect_signals(video_path, make_probe_result(duration_ms=400))
    assert stable_result.scene_change_timestamps_ms == []
    assert stable_result.slow_visual_change_timestamps_ms == []
    assert stable_result.sampled_frame_count == 4
    assert stable_result.config["sampleWidth"] == width
    assert stable_result.config["sampleHeight"] == height
    assert "localPath" not in json.dumps(stable_result.to_manifest())
    assert calls[1][calls[1].index("-v") + 1] == "info"
    assert calls[1][calls[1].index("-map") + 1] == "0:0"
    assert calls[1][calls[1].index("-frames:v") + 1] == "4"

    def scene_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        timestamps = [0, 100, 200, 300]
        frames = [
            frame_bytes(width, height, 0),
            frame_bytes(width, height, 0),
            frame_bytes(width, height, 255),
            frame_bytes(width, height, 255),
        ]
        return {
            "stdout": raw_output(frames),
            "stderr": showinfo_stderr(timestamps),
            "returncode": 0,
        }

    scene_result = VisualSignalDetector(
        workspace_root=tmp_path,
        config=config,
        command_runner=scene_runner,
    ).detect_signals(video_path, make_probe_result(duration_ms=400))
    assert scene_result.scene_change_timestamps_ms == [200]
    assert scene_result.slow_visual_change_timestamps_ms == []

    def slow_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        timestamps = [0, 100, 200, 300, 400]
        frames = [
            board_frame(width, height, 0),
            board_frame(width, height, 4),
            board_frame(width, height, 8),
            board_frame(width, height, 12),
            board_frame(width, height, 16),
        ]
        return {
            "stdout": raw_output(frames),
            "stderr": showinfo_stderr(timestamps),
            "returncode": 0,
        }

    slow_result = VisualSignalDetector(
        workspace_root=tmp_path,
        config=config,
        command_runner=slow_runner,
    ).detect_signals(video_path, make_probe_result(duration_ms=500))
    assert slow_result.scene_change_timestamps_ms == []
    assert slow_result.slow_visual_change_timestamps_ms == [400]


def test_visual_signal_detector_resets_slow_accumulation_caps_outputs_and_is_deterministic(
    tmp_path: Path,
) -> None:
    video_path = tmp_path / "lesson.mp4"
    write_fake_video(video_path)
    config = make_config(
        max_samples=9,
        max_scene_signals=1,
        max_slow_signals=2,
        min_signal_spacing_ms=150,
    )
    width = config.sample_width
    height = config.sample_height

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        timestamps = [0, 100, 200, 300, 400, 500, 600, 700, 800]
        frames = [
            board_frame(width, height, 0),
            board_frame(width, height, 4),
            board_frame(width, height, 8),
            frame_bytes(width, height, 255),
            board_frame(width, height, 170),
            board_frame(width, height, 174),
            board_frame(width, height, 178),
            board_frame(width, height, 182),
            board_frame(width, height, 186),
        ]
        return {
            "stdout": raw_output(frames),
            "stderr": showinfo_stderr(timestamps),
            "returncode": 0,
        }

    detector = VisualSignalDetector(
        workspace_root=tmp_path,
        config=config,
        command_runner=runner,
    )
    first = detector.detect_signals(video_path, make_probe_result(duration_ms=900))
    second = detector.detect_signals(video_path, make_probe_result(duration_ms=900))
    assert first.scene_change_timestamps_ms == [300]
    assert first.slow_visual_change_timestamps_ms == [800]
    assert first.to_manifest() == second.to_manifest()
    assert 300 not in first.slow_visual_change_timestamps_ms


def test_visual_signal_detector_adapts_interval_and_frame_caps_for_long_video(
    tmp_path: Path,
) -> None:
    video_path = tmp_path / "lesson.mp4"
    write_fake_video(video_path)
    config = make_config(
        min_sample_interval_ms=100,
        max_samples=5,
        sample_width=20,
        sample_height=10,
    )
    calls: list[list[str]] = []

    def runner(args: list[str], **_: object):
        calls.append(args)
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        timestamps = [0, 1200, 2400, 3600, 4800]
        frames = [frame_bytes(config.sample_width, config.sample_height, 0) for _ in timestamps]
        return {
            "stdout": raw_output(frames),
            "stderr": showinfo_stderr(timestamps),
            "returncode": 0,
        }

    detector = VisualSignalDetector(workspace_root=tmp_path, config=config, command_runner=runner)
    result = detector.detect_signals(
        video_path,
        make_probe_result(duration_ms=6000, primary_video_stream_index=2),
    )

    command = calls[1]
    assert command[command.index("-v") + 1] == "info"
    assert command[command.index("-map") + 1] == "0:2"
    assert command[command.index("-frames:v") + 1] == "5"
    filter_arg = command[command.index("-vf") + 1]
    assert "fps=1/1.200" in filter_arg
    assert result.config["sampleIntervalMs"] == 1200


def test_visual_signal_detector_maps_timeout_nonzero_and_malformed_raw_output_to_stable_errors(
    tmp_path: Path,
) -> None:
    video_path = tmp_path / "lesson.mp4"
    write_fake_video(video_path)
    config = make_config()
    width = config.sample_width
    height = config.sample_height

    def timeout_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        raise MediaAdapterError("MEDIA_SUBPROCESS_TIMEOUT", "secret-timeout")

    detector = VisualSignalDetector(workspace_root=tmp_path, config=config, command_runner=timeout_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        detector.detect_signals(video_path, make_probe_result())
    assert error_info.value.code == "VISUAL_SIGNAL_DETECT_TIMEOUT"
    assert "secret-timeout" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")

    def nonzero_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {"stdout": b"", "stderr": b"secret-stderr", "returncode": 1}

    detector = VisualSignalDetector(workspace_root=tmp_path, config=config, command_runner=nonzero_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        detector.detect_signals(video_path, make_probe_result())
    assert error_info.value.code == "VISUAL_SIGNAL_DETECT_FAILED"
    assert "secret-stderr" not in str(error_info.value)

    def malformed_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        timestamps = [0, 100, 200]
        bad_frame = raw_output([frame_bytes(width, height, 0)]) + b"\x00"
        return {
            "stdout": bad_frame,
            "stderr": showinfo_stderr(timestamps),
            "returncode": 0,
        }

    detector = VisualSignalDetector(workspace_root=tmp_path, config=config, command_runner=malformed_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        detector.detect_signals(video_path, make_probe_result())
    assert error_info.value.code == "VISUAL_SIGNAL_DETECT_FAILED"


def test_visual_signal_detector_rejects_oversized_and_zero_sample_outputs_and_emits_degradation(
    tmp_path: Path,
) -> None:
    video_path = tmp_path / "lesson.mp4"
    write_fake_video(video_path)
    config = make_config(max_stdout_bytes_margin=8)
    width = config.sample_width
    height = config.sample_height

    def overflow_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": raw_output([frame_bytes(width, height, 0)]) + b"x" * 4096,
            "stderr": showinfo_stderr([0]),
            "returncode": 0,
        }

    detector = VisualSignalDetector(workspace_root=tmp_path, config=config, command_runner=overflow_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        detector.detect_signals(video_path, make_probe_result())
    assert error_info.value.code == "VISUAL_SIGNAL_DETECT_FAILED"

    def zero_sample_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    detector = VisualSignalDetector(workspace_root=tmp_path, config=config, command_runner=zero_sample_runner)
    result = detector.detect_signals(video_path, make_probe_result())
    assert isinstance(result, VisualSignalDetectionResult)
    assert result.scene_change_timestamps_ms == []
    assert result.slow_visual_change_timestamps_ms == []
    assert result.degradations[0]["code"] == "NO_VISUAL_SAMPLES"

    def timestamp_only_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {"stdout": b"", "stderr": showinfo_stderr([0]), "returncode": 0}

    detector = VisualSignalDetector(workspace_root=tmp_path, config=config, command_runner=timestamp_only_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        detector.detect_signals(video_path, make_probe_result())
    assert error_info.value.code == "VISUAL_SIGNAL_DETECT_FAILED"

    def extra_frame_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        timestamps = list(range(0, 1300, 100))
        frames = [frame_bytes(width, height, 0) for _ in timestamps]
        return {
            "stdout": raw_output(frames),
            "stderr": showinfo_stderr(timestamps),
            "returncode": 0,
        }

    detector = VisualSignalDetector(workspace_root=tmp_path, config=config, command_runner=extra_frame_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        detector.detect_signals(video_path, make_probe_result(duration_ms=1200))
    assert error_info.value.code == "VISUAL_SIGNAL_DETECT_FAILED"


def test_visual_signal_detector_detects_sub_threshold_gradual_writing_and_resets_on_mid_jump(
    tmp_path: Path,
) -> None:
    video_path = tmp_path / "lesson.mp4"
    write_fake_video(video_path)
    config = make_config()
    width = config.sample_width
    height = config.sample_height

    def gradual_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        timestamps = [index * 100 for index in range(10)]
        frames = [board_frame(width, height, index * 2) for index in range(10)]
        return {
            "stdout": raw_output(frames),
            "stderr": showinfo_stderr(timestamps),
            "returncode": 0,
        }

    gradual_result = VisualSignalDetector(
        workspace_root=tmp_path,
        config=config,
        command_runner=gradual_runner,
    ).detect_signals(video_path, make_probe_result(duration_ms=1000))
    assert gradual_result.scene_change_timestamps_ms == []
    assert gradual_result.slow_visual_change_timestamps_ms == [800]
    assert gradual_result.config["slowChangeMaxStepThreshold"] == 0.02

    def reset_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        timestamps = [index * 100 for index in range(7)]
        frames = [
            board_frame(width, height, 0),
            board_frame(width, height, 10),
            board_frame(width, height, 12),
            board_frame(width, height, 14),
            board_frame(width, height, 16),
            board_frame(width, height, 18),
            board_frame(width, height, 20),
        ]
        return {
            "stdout": raw_output(frames),
            "stderr": showinfo_stderr(timestamps),
            "returncode": 0,
        }

    reset_result = VisualSignalDetector(
        workspace_root=tmp_path,
        config=config,
        command_runner=reset_runner,
    ).detect_signals(video_path, make_probe_result(duration_ms=700))
    assert reset_result.scene_change_timestamps_ms == []
    assert reset_result.slow_visual_change_timestamps_ms == []


def test_visual_signal_detector_real_ffmpeg_smoke(tmp_path: Path) -> None:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        pytest.skip("ffmpeg/ffprobe not available")

    video_path = tmp_path / "dynamic.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=2:size=320x180:rate=10",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(video_path),
        ],
        check=True,
    )
    probe_adapter = FfprobeAdapter(workspace_root=tmp_path)
    detector = VisualSignalDetector(workspace_root=tmp_path, config=make_config(max_samples=10))
    result = detector.detect_signals(video_path, probe_adapter.probe_media(video_path, source_kind="video"))

    assert result.sampled_frame_count > 0
    assert isinstance(result.scene_change_timestamps_ms, list)
    assert isinstance(result.slow_visual_change_timestamps_ms, list)
    assert result.config["sampleWidth"] == 20
