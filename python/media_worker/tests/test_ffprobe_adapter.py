from __future__ import annotations

import json
import shutil
import wave
from pathlib import Path

import pytest

from media_worker.errors import MediaAdapterError
from media_worker.ffprobe_adapter import FfprobeAdapter


MAX_SAFE_INTEGER = 2**53 - 1


def make_ffprobe_json(
    *,
    format_duration: str | None = "1.25",
    format_name: str = "mov,mp4,m4a,3gp,3g2,mj2",
    size: str = "1024",
    bit_rate: str = "64000",
    streams: list[dict[str, object]],
) -> bytes:
    format_payload: dict[str, object] = {
        "format_name": format_name,
        "size": size,
        "bit_rate": bit_rate,
    }
    if format_duration is not None:
        format_payload["duration"] = format_duration
    payload = {
        "format": format_payload,
        "streams": streams,
        "chapters": [],
    }
    return json.dumps(payload).encode("utf-8")


def make_audio_stream(
    *,
    index: int = 0,
    codec_name: str = "aac",
    duration: str = "1.25",
    default: int | bool = 1,
    sample_rate: str | int = "48000",
    channels: str | int = "2",
    channel_layout: str = "stereo",
) -> dict[str, object]:
    return {
        "index": index,
        "codec_type": "audio",
        "codec_name": codec_name,
        "duration": duration,
        "time_base": "1/48000",
        "sample_rate": sample_rate,
        "channels": channels,
        "channel_layout": channel_layout,
        "disposition": {"default": default},
    }


def make_video_stream(
    *,
    index: int = 0,
    codec_name: str = "h264",
    duration: str = "2.0",
    default: int | bool = 1,
    attached_pic: int | bool = 0,
    avg_frame_rate: str = "25/1",
    width: str | int = 1280,
    height: str | int = 720,
) -> dict[str, object]:
    return {
        "index": index,
        "codec_type": "video",
        "codec_name": codec_name,
        "duration": duration,
        "time_base": "1/1000",
        "width": width,
        "height": height,
        "avg_frame_rate": avg_frame_rate,
        "disposition": {"default": default, "attached_pic": attached_pic},
    }


def stable_error_parts(error: MediaAdapterError) -> tuple[str | None, str | None]:
    return repr(error.__cause__), repr(error.__context__)


def test_probe_audio_source_ignores_attached_picture_and_omits_local_path(
    tmp_path: Path,
) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")
    calls: list[list[str]] = []

    def runner(args: list[str], **_: object):
        calls.append(args)
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(
                streams=[
                    make_audio_stream(index=0),
                    make_video_stream(index=1, codec_name="mjpeg", attached_pic=1, avg_frame_rate="0/0"),
                ]
            ),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=runner)

    result = adapter.probe_media(audio_file, source_kind="audio")

    assert result.duration_ms == 1250
    assert result.has_audio is True
    assert result.has_video is False
    assert result.primary_audio_stream_index == 0
    assert result.primary_video_stream_index is None
    assert result.degradation is None
    manifest = result.to_manifest()
    assert manifest["ffprobeVersion"] == "8.1.1"
    assert manifest["hasVideo"] is False
    assert "localPath" not in json.dumps(manifest)
    assert calls[1] == [
        "ffprobe",
        "-hide_banner",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        "--",
        str(audio_file),
    ]


def test_probe_video_source_without_audio_degrades_visual_only(tmp_path: Path) -> None:
    video_file = tmp_path / "lesson.mp4"
    video_file.write_bytes(b"fake")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(streams=[make_video_stream(index=0)]),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=runner)

    result = adapter.probe_media(video_file, source_kind="video")

    assert result.has_audio is False
    assert result.has_video is True
    assert result.primary_video_stream_index == 0
    assert result.degradation == {"mode": "visual_only", "reason": "no_audio_track"}


@pytest.mark.parametrize(
    ("kwargs", "expected_code"),
    [
        ({"workspace_root": Path("missing-root")}, "MEDIA_PROBE_FAILED"),
        ({"ffprobe_path": ""}, "MEDIA_PROBE_FAILED"),
        ({"command_runner": "not-callable"}, "MEDIA_PROBE_FAILED"),
        ({"timeout_seconds": True}, "MEDIA_PROBE_FAILED"),
        ({"timeout_seconds": 0}, "MEDIA_PROBE_FAILED"),
        ({"max_stdout_bytes": False}, "MEDIA_PROBE_FAILED"),
        ({"max_stdout_bytes": 0}, "MEDIA_PROBE_FAILED"),
        ({"max_stderr_bytes": -1}, "MEDIA_PROBE_FAILED"),
        ({"max_duration_ms": True}, "MEDIA_PROBE_FAILED"),
        ({"max_duration_ms": MAX_SAFE_INTEGER + 1}, "MEDIA_PROBE_FAILED"),
    ],
)
def test_ffprobe_adapter_rejects_invalid_configuration(
    tmp_path: Path,
    kwargs: dict[str, object],
    expected_code: str,
) -> None:
    init_kwargs = {"workspace_root": tmp_path}
    init_kwargs.update(kwargs)

    with pytest.raises(MediaAdapterError) as error_info:
        FfprobeAdapter(**init_kwargs)

    error = error_info.value
    assert error.code == expected_code


def test_ffprobe_adapter_maps_workspace_resolve_runtime_error_to_stable_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_root = Path("secret-workspace")
    real_resolve = Path.resolve

    def fake_resolve(self: Path, strict: bool = False) -> Path:
        if self == workspace_root:
            raise RuntimeError("secret-os-path")
        return real_resolve(self, strict=strict)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    with pytest.raises(MediaAdapterError) as error_info:
        FfprobeAdapter(workspace_root=workspace_root)

    error = error_info.value
    assert error.code == "MEDIA_PROBE_FAILED"
    assert "secret-os-path" not in str(error)
    assert "secret-os-path" not in repr(error)
    assert stable_error_parts(error) == ("None", "None")


def test_probe_rejects_invalid_source_kind_runtime_value(tmp_path: Path) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {"stdout": make_ffprobe_json(streams=[make_audio_stream()]), "stderr": b"", "returncode": 0}

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=runner)

    with pytest.raises(MediaAdapterError, match="MEDIA_PROBE_FAILED"):
        adapter.probe_media(audio_file, source_kind="document")  # type: ignore[arg-type]


def test_probe_normalizes_runner_results_with_output_limits(tmp_path: Path) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")
    oversized_stdout = b"x" * 65

    def version_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": oversized_stdout, "stderr": b"", "returncode": 0}
        return {"stdout": make_ffprobe_json(streams=[make_audio_stream()]), "stderr": b"", "returncode": 0}

    adapter = FfprobeAdapter(
        workspace_root=tmp_path,
        command_runner=version_runner,
        max_stdout_bytes=64,
    )

    with pytest.raises(MediaAdapterError, match="MEDIA_PROBE_FAILED"):
        adapter.probe_media(audio_file, source_kind="audio")

    def probe_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {"stdout": oversized_stdout, "stderr": b"", "returncode": 0}

    adapter = FfprobeAdapter(
        workspace_root=tmp_path,
        command_runner=probe_runner,
        max_stdout_bytes=64,
    )

    with pytest.raises(MediaAdapterError, match="MEDIA_PROBE_FAILED"):
        adapter.probe_media(audio_file, source_kind="audio")


def test_probe_maps_timeout_and_non_utf8_version_to_stable_errors(tmp_path: Path) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")

    def timeout_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            raise MediaAdapterError("MEDIA_SUBPROCESS_TIMEOUT", "secret-timeout")
        return {"stdout": make_ffprobe_json(streams=[make_audio_stream()]), "stderr": b"", "returncode": 0}

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=timeout_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        adapter.probe_media(audio_file, source_kind="audio")
    timeout_error = error_info.value
    assert timeout_error.code == "MEDIA_PROBE_TIMEOUT"
    assert "secret-timeout" not in str(timeout_error)
    assert stable_error_parts(timeout_error) == ("None", "None")

    def bad_utf8_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"\xff\xfe\xfd", "stderr": b"", "returncode": 0}
        return {"stdout": make_ffprobe_json(streams=[make_audio_stream()]), "stderr": b"", "returncode": 0}

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=bad_utf8_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        adapter.probe_media(audio_file, source_kind="audio")
    assert error_info.value.code == "MEDIA_PROBE_FAILED"
    assert stable_error_parts(error_info.value) == ("None", "None")


@pytest.mark.parametrize(
    "streams",
    [
        [make_audio_stream(index=True)],  # type: ignore[arg-type]
        [make_audio_stream(index=0), make_audio_stream(index=0)],
        [make_audio_stream(codec_name="bad\x00name")],
        [make_audio_stream(default="yes")],  # type: ignore[arg-type]
        [make_audio_stream(sample_rate=str(MAX_SAFE_INTEGER + 1))],
        [make_audio_stream(channels="0")],
        [make_video_stream(width=str(MAX_SAFE_INTEGER + 1))],
        [make_video_stream(height="0")],
        [make_audio_stream(duration=str(float("inf")))],
        [make_audio_stream(channel_layout="bad\nlayout")],
    ],
)
def test_probe_rejects_invalid_stream_shapes(tmp_path: Path, streams: list[dict[str, object]]) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {"stdout": make_ffprobe_json(streams=streams), "stderr": b"", "returncode": 0}

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=runner)

    with pytest.raises(MediaAdapterError):
        adapter.probe_media(audio_file, source_kind="audio")


def test_probe_rejects_invalid_optional_strings_and_numbers(tmp_path: Path) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(
                format_name="bad\rname",
                size=str(MAX_SAFE_INTEGER + 1),
                streams=[make_audio_stream()],
            ),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=runner)

    with pytest.raises(MediaAdapterError):
        adapter.probe_media(audio_file, source_kind="audio")


def test_ffprobe_adapter_rejects_timeout_seconds_overflow_with_stable_error(tmp_path: Path) -> None:
    with pytest.raises(MediaAdapterError) as error_info:
        FfprobeAdapter(workspace_root=tmp_path, timeout_seconds=10**1000)

    error = error_info.value
    assert error.code == "MEDIA_PROBE_FAILED"
    assert stable_error_parts(error) == ("None", "None")


def test_probe_rejects_duration_integer_and_scaled_float_overflow_with_stable_error(tmp_path: Path) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")

    def huge_int_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(
                format_duration=str(10**1000),
                streams=[make_audio_stream(duration="1.0")],
            ),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=huge_int_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        adapter.probe_media(audio_file, source_kind="audio")
    assert error_info.value.code == "MEDIA_PROBE_UNSUPPORTED"
    assert stable_error_parts(error_info.value) == ("None", "None")

    def huge_float_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(
                format_duration="1.7976931348623157e308",
                streams=[make_audio_stream(duration="1.0")],
            ),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=huge_float_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        adapter.probe_media(audio_file, source_kind="audio")
    assert error_info.value.code == "MEDIA_PROBE_UNSUPPORTED"
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_probe_duration_fallback_ignores_cover_art_and_non_media_streams(tmp_path: Path) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(
                format_duration=None,
                streams=[
                    {
                        "index": 0,
                        "codec_type": "subtitle",
                        "codec_name": "mov_text",
                        "duration": "500",
                        "time_base": "1/1000",
                        "disposition": {"default": 1},
                    },
                    make_video_stream(index=1, codec_name="mjpeg", attached_pic=1, duration="999", avg_frame_rate="0/0"),
                    make_audio_stream(index=2, duration="1.5", default=0),
                ],
            ),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=runner)
    result = adapter.probe_media(audio_file, source_kind="audio")

    assert result.duration_ms == 1500


def test_probe_prefers_default_primary_stream_indices(tmp_path: Path) -> None:
    video_file = tmp_path / "lesson.mp4"
    video_file.write_bytes(b"fake")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(
                streams=[
                    make_audio_stream(index=0, default=0, codec_name="aac"),
                    make_audio_stream(index=1, default=1, codec_name="aac"),
                    make_video_stream(index=2, default=0),
                    make_video_stream(index=3, default=1),
                ]
            ),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=runner)
    result = adapter.probe_media(video_file, source_kind="video")

    assert result.primary_audio_stream_index == 1
    assert result.primary_video_stream_index == 3


def test_probe_maps_bad_stdout_and_invalid_shapes_to_stable_errors(tmp_path: Path) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {"stdout": b"\xff\xfe\xff", "stderr": b"secret-stderr", "returncode": 0}

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=runner)

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.probe_media(audio_file, source_kind="audio")

    error = error_info.value
    assert error.code == "MEDIA_PROBE_FAILED"
    assert "lesson.m4a" not in str(error)
    assert "secret-stderr" not in str(error)
    assert stable_error_parts(error) == ("None", "None")


def test_probe_duration_parse_and_disposition_errors_clear_exception_context(tmp_path: Path) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")

    def duration_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(
                format_duration="secret-duration",
                streams=[make_audio_stream(duration="1.0")],
            ),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=duration_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        adapter.probe_media(audio_file, source_kind="audio")
    assert error_info.value.code == "MEDIA_PROBE_UNSUPPORTED"
    assert "secret-duration" not in str(error_info.value)
    assert "secret-duration" not in repr(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")

    def disposition_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(
                streams=[
                    make_audio_stream(
                        default=[],
                    )
                ]
            ),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=disposition_runner)
    with pytest.raises(MediaAdapterError) as error_info:
        adapter.probe_media(audio_file, source_kind="audio")
    assert error_info.value.code == "MEDIA_PROBE_FAILED"
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_probe_rejects_stream_duration_above_configured_maximum(tmp_path: Path) -> None:
    audio_file = tmp_path / "lesson.m4a"
    audio_file.write_bytes(b"fake")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffprobe version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {
            "stdout": make_ffprobe_json(
                format_duration="1.0",
                streams=[make_audio_stream(duration="2.5")],
            ),
            "stderr": b"",
            "returncode": 0,
        }

    adapter = FfprobeAdapter(
        workspace_root=tmp_path,
        command_runner=runner,
        max_duration_ms=1000,
    )

    with pytest.raises(MediaAdapterError, match="MEDIA_PROBE_UNSUPPORTED"):
        adapter.probe_media(audio_file, source_kind="audio")


def test_probe_rejects_workspace_escape_directory_and_missing_file(tmp_path: Path) -> None:
    directory = tmp_path / "nested"
    directory.mkdir()
    missing = tmp_path / "missing.wav"
    outside = tmp_path.parent / "outside.wav"
    outside.write_bytes(b"outside")

    adapter = FfprobeAdapter(workspace_root=tmp_path, command_runner=lambda *_args, **_kwargs: None)

    for bad_path in [directory, missing, outside]:
        with pytest.raises(MediaAdapterError) as error_info:
            adapter.probe_media(bad_path, source_kind="audio")
        assert error_info.value.code == "MEDIA_PROBE_FAILED"
        assert "outside.wav" not in str(error_info.value)


def test_probe_real_ffprobe_wav_integration(tmp_path: Path) -> None:
    if shutil.which("ffprobe") is None:
        pytest.skip("ffprobe not available")

    wav_path = tmp_path / "probe.wav"
    with wave.open(str(wav_path), "wb") as output_file:
        output_file.setnchannels(1)
        output_file.setsampwidth(2)
        output_file.setframerate(16000)
        output_file.writeframes(b"\x00\x00" * 1600)

    adapter = FfprobeAdapter(workspace_root=tmp_path)

    result = adapter.probe_media(wav_path, source_kind="audio")

    assert result.has_audio is True
    assert result.has_video is False
    assert result.duration_ms > 0
    assert result.streams[0]["audio"]["sampleRate"] == 16000
