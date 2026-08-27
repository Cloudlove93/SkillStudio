from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from media_worker.errors import MediaAdapterError
from media_worker.ffprobe_adapter import FfprobeAdapter
from media_worker.frame_materializer import (
    FrameMaterializer,
    FrameMaterializerConfig,
    FrameRequest,
    MaterializedFrame,
)


class RecordingProbeAdapter:
    def __init__(self, result: object = None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.calls: list[tuple[Path, str | None]] = []

    def probe_media(self, input_path: Path, *, source_kind: str | None):
        self.calls.append((input_path, source_kind))
        if self.error is not None:
            raise self.error
        return self.result


def make_config(**overrides: object) -> FrameMaterializerConfig:
    config_kwargs = {
        "processor_version": "frame-materializer-v1",
        "max_candidates": 48,
        "max_width": 320,
        "max_output_bytes": 512 * 1024,
        "max_image_pixels": 320 * 240,
        "timeout_seconds": 10.0,
        "max_stdout_bytes": 32 * 1024,
        "max_stderr_bytes": 32 * 1024,
        "create_output_token": lambda: str(uuid.uuid4()),
    }
    config_kwargs.update(overrides)
    return FrameMaterializerConfig(**config_kwargs)


def make_request(**overrides: object) -> FrameRequest:
    request_kwargs = {
        "candidate_id": "candidate-001",
        "semantic_moment_id": "moment-001",
        "timestamp_ms": 100,
        "source_signal": "scene_change",
        "selection_reason": "stable cue",
    }
    request_kwargs.update(overrides)
    return FrameRequest(**request_kwargs)


def stable_error_parts(error: MediaAdapterError) -> tuple[str | None, str | None]:
    return repr(error.__cause__), repr(error.__context__)


def write_png(path: Path, *, color: tuple[int, int, int] = (12, 34, 56), size: tuple[int, int] = (80, 40)) -> None:
    image = Image.new("RGB", size, color)
    image.save(path, format="PNG")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(64 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def test_frame_materializer_rejects_invalid_config_and_requests(tmp_path: Path) -> None:
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )

    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(max_candidates=True))
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(max_width=0))
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(create_output_token="bad"))
    with pytest.raises(MediaAdapterError) as error_info:
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(timeout_seconds=float("nan")))
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert stable_error_parts(error_info.value) == ("None", "None")
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(timeout_seconds=float("inf")))
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(timeout_seconds=10**1000))
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(max_output_bytes=10**100))
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(max_stdout_bytes=10**100))
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(max_stderr_bytes=10**100))
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(max_image_pixels=10**100))
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config(processor_version="bad version"))

    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    materializer = FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config())

    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests="abc")  # type: ignore[arg-type]
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert stable_error_parts(error_info.value) == ("None", "None")
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        materializer.materialize_frames(video_path, requests=[object()])  # type: ignore[list-item]
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        materializer.materialize_frames(
            video_path,
            requests=[
                make_request(candidate_id="dup"),
                make_request(candidate_id="dup", semantic_moment_id="moment-002"),
            ],
        )
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        materializer.materialize_frames(
            video_path,
            requests=[make_request(source_signal="keyword_boost")],  # type: ignore[arg-type]
        )
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(
            video_path,
            requests=[make_request(source_signal=["bad"])],  # type: ignore[arg-type]
        )
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert stable_error_parts(error_info.value) == ("None", "None")
    with pytest.raises(MediaAdapterError, match="FRAME_MATERIALIZE_FAILED"):
        materializer.materialize_frames(
            video_path,
            requests=[make_request(timestamp_ms=1000)],
        )

    valid_local_path = tmp_path / "valid.png"
    write_png(valid_local_path)
    with pytest.raises(MediaAdapterError) as error_info:
        MaterializedFrame(
            candidate_id="candidate-001",
            semantic_moment_id="moment-001",
            timestamp_ms=1,
            source_signal={"bad": "signal"},  # type: ignore[arg-type]
            selection_reason="stable cue",
            local_path=valid_local_path,
            mime_type="image/png",
            size_bytes=valid_local_path.stat().st_size,
            sha256=sha256_file(valid_local_path),
            width=80,
            height=40,
            ffmpeg_version="8.1.1",
            frame_extractor_version="frame-materializer-v1",
        )
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_frame_materializer_rejects_request_iteration_failures_stably(tmp_path: Path) -> None:
    class ExplodingRequests:
        def __len__(self):
            raise RuntimeError("secret-len")

        def __iter__(self):
            raise RuntimeError("secret-iter")

    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )
    materializer = FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config())

    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=ExplodingRequests())  # type: ignore[arg-type]
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert "secret-len" not in str(error_info.value)
    assert "secret-iter" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_frame_materializer_maps_probe_errors_and_missing_video_track(tmp_path: Path) -> None:
    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")

    timeout_probe = RecordingProbeAdapter(
        error=MediaAdapterError("MEDIA_PROBE_TIMEOUT", "secret-timeout"),
    )
    materializer = FrameMaterializer(workspace_root=tmp_path, probe_adapter=timeout_probe, config=make_config())
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_TIMEOUT"
    assert stable_error_parts(error_info.value) == ("None", "None")

    no_video_probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=False, duration_ms=1000, primary_video_stream_index=None)
    )
    materializer = FrameMaterializer(workspace_root=tmp_path, probe_adapter=no_video_probe, config=make_config())
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_VIDEO_TRACK_MISSING"
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_frame_materializer_rejects_probe_attribute_shape_and_getter_errors(tmp_path: Path) -> None:
    class ExplodingProbeResult:
        @property
        def has_video(self):
            raise RuntimeError("secret-has-video")

    class BoolIndexProbeResult:
        has_video = True
        duration_ms = 1000
        primary_video_stream_index = True

    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=RecordingProbeAdapter(result=ExplodingProbeResult()),
        config=make_config(),
    )
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert "secret-has-video" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=RecordingProbeAdapter(result=BoolIndexProbeResult()),
        config=make_config(),
    )
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_VIDEO_TRACK_MISSING"
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_frame_materializer_rejects_escape_and_symlink_inputs(tmp_path: Path) -> None:
    outside_video = tmp_path.parent / "outside-video.mp4"
    outside_video.write_bytes(b"outside")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )
    materializer = FrameMaterializer(workspace_root=tmp_path, probe_adapter=probe, config=make_config())

    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(outside_video, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"

    symlink_path = tmp_path / "linked.mp4"
    try:
        os.symlink(outside_video, symlink_path)
    except (OSError, NotImplementedError):
        pytest.skip("symlink creation not available")

    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(symlink_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"


def test_frame_materializer_rejects_bad_output_token_and_existing_output(tmp_path: Path) -> None:
    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )

    bad_token = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(create_output_token=lambda: "../../escape"),
    )
    with pytest.raises(MediaAdapterError) as error_info:
        bad_token.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"

    fixed_token = "9b657c24-2d73-4ee1-8cd6-91dfce2b4e9e"
    output_directory = tmp_path / "frame-candidates"
    output_directory.mkdir(exist_ok=True)
    existing_final = output_directory / f"{fixed_token}.png"
    existing_final.write_bytes(b"keep-me")
    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(create_output_token=lambda: fixed_token),
    )
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert existing_final.read_bytes() == b"keep-me"


def test_frame_materializer_cleans_up_failed_outputs_and_maps_timeout(tmp_path: Path) -> None:
    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )

    def timeout_runner(args: list[str], **_: object):
        raise MediaAdapterError("MEDIA_SUBPROCESS_TIMEOUT", "secret-command-timeout")

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(),
        command_runner=timeout_runner,
    )
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_TIMEOUT"
    assert stable_error_parts(error_info.value) == ("None", "None")

    def corrupt_runner(args: list[str], **_: object):
        output_path = Path(args[-1])
        output_path.write_bytes(b"not-a-png")
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(create_output_token=lambda: "a17a4d11-b42b-4aa8-9cab-aac3d77978f1"),
        command_runner=corrupt_runner,
    )
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert not any((tmp_path / "frame-candidates").glob("a17a4d11-b42b-4aa8-9cab-aac3d77978f1*"))


def test_frame_materializer_cleans_up_previous_batch_outputs_when_later_candidate_fails(tmp_path: Path) -> None:
    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )
    tokens = iter(
        [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
        ]
    )
    calls = {"count": 0}

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        calls["count"] += 1
        output_path = Path(args[-1])
        if calls["count"] == 1:
            write_png(output_path, color=(10, 20, 30))
            return {"stdout": b"", "stderr": b"", "returncode": 0}
        return {"stdout": b"", "stderr": b"boom", "returncode": 1}

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(create_output_token=lambda: next(tokens)),
        command_runner=runner,
    )

    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(
            video_path,
            requests=[
                make_request(candidate_id="candidate-001"),
                make_request(candidate_id="candidate-002", semantic_moment_id="moment-002", timestamp_ms=200),
            ],
        )
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert not any((tmp_path / "frame-candidates").glob("11111111-1111-4111-8111-111111111111*"))
    assert not any((tmp_path / "frame-candidates").glob("22222222-2222-4222-8222-222222222222*"))


def test_frame_materializer_cleans_up_previous_batch_outputs_on_unexpected_exception(tmp_path: Path) -> None:
    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )
    tokens = iter(
        [
            "33333333-3333-4333-8333-333333333333",
            "44444444-4444-4444-8444-444444444444",
        ]
    )
    calls = {"count": 0}

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        calls["count"] += 1
        output_path = Path(args[-1])
        if calls["count"] == 1:
            write_png(output_path, color=(20, 30, 40))
            return {"stdout": b"", "stderr": b"", "returncode": 0}
        raise RuntimeError("secret-batch")

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(create_output_token=lambda: next(tokens)),
        command_runner=runner,
    )

    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(
            video_path,
            requests=[
                make_request(candidate_id="candidate-001"),
                make_request(candidate_id="candidate-002", semantic_moment_id="moment-002", timestamp_ms=200),
            ],
        )
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert "secret-batch" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")
    assert not any((tmp_path / "frame-candidates").glob("33333333-3333-4333-8333-333333333333*"))
    assert not any((tmp_path / "frame-candidates").glob("44444444-4444-4444-8444-444444444444*"))


def test_frame_materializer_uses_streaming_hash_and_omits_local_path_from_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )

    def png_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {
                "stdout": b"ffmpeg version 7.1.5-0+deb13u1\n",
                "stderr": b"",
                "returncode": 0,
            }
        output_path = Path(args[-1])
        write_png(output_path, color=(70, 120, 160))
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    monkeypatch.setattr(Path, "read_bytes", lambda self: (_ for _ in ()).throw(AssertionError("read_bytes must not be used")))
    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(create_output_token=lambda: "6d84b0db-c0a9-4ae2-a196-1041844fe89a"),
        command_runner=png_runner,
    )

    result = materializer.materialize_frames(video_path, requests=[make_request()])[0]
    manifest = result.to_manifest()

    assert result.local_path.exists()
    assert result.sha256 == sha256_file(result.local_path)
    assert result.ffmpeg_version == "7.1.5-0+deb13u1"
    assert "localPath" not in str(manifest)
    assert manifest["asset"]["mimeType"] == "image/png"
    assert manifest["frameExtractorVersion"] == "frame-materializer-v1"


def test_frame_materializer_rejects_bad_version_and_command_output_limits(tmp_path: Path) -> None:
    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )

    def bad_version_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"not-ffmpeg 8.1.1\n", "stderr": b"", "returncode": 0}
        write_png(Path(args[-1]))
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(),
        command_runner=bad_version_runner,
    )
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"


def test_frame_materializer_masks_probe_adapter_attr_and_partial_exists_failures(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class ExplodingProbeAdapter:
        @property
        def probe_media(self):
            raise RuntimeError("secret-probe-attr")

    with pytest.raises(MediaAdapterError) as error_info:
        FrameMaterializer(
            workspace_root=tmp_path,
            probe_adapter=ExplodingProbeAdapter(),  # type: ignore[arg-type]
            config=make_config(),
        )
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert "secret-probe-attr" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")

    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )

    def png_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        output_path = Path(args[-1])
        write_png(output_path)
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(create_output_token=lambda: "55555555-5555-4555-8555-555555555555"),
        command_runner=png_runner,
    )
    original_exists = Path.exists

    def fake_exists(self: Path):
        if self.name == "55555555-5555-4555-8555-555555555555.png.partial":
            raise RuntimeError("secret-exists")
        return original_exists(self)

    monkeypatch.setattr(Path, "exists", fake_exists)
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert "secret-exists" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")
    assert not any((tmp_path / "frame-candidates").glob("55555555-5555-4555-8555-555555555555*"))
    assert stable_error_parts(error_info.value) == ("None", "None")

    def overflow_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        return {"stdout": b"x" * 65, "stderr": b"", "returncode": 0}

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(max_stdout_bytes=64),
        command_runner=overflow_runner,
    )
    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"


def test_frame_materializer_cleanup_does_not_mask_primary_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    video_path = tmp_path / "input.mp4"
    video_path.write_bytes(b"fake")
    probe = RecordingProbeAdapter(
        result=SimpleNamespace(has_video=True, duration_ms=1000, primary_video_stream_index=0)
    )

    def corrupt_runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        output_path = Path(args[-1])
        output_path.write_bytes(b"not-a-png")
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe,
        config=make_config(create_output_token=lambda: "66666666-6666-4666-8666-666666666666"),
        command_runner=corrupt_runner,
    )
    original_unlink = Path.unlink

    def exploding_unlink(self: Path, *args: object, **kwargs: object):
        if self.name.startswith("66666666-6666-4666-8666-666666666666"):
            raise RuntimeError("secret-cleanup")
        return original_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", exploding_unlink)

    with pytest.raises(MediaAdapterError) as error_info:
        materializer.materialize_frames(video_path, requests=[make_request()])
    assert error_info.value.code == "FRAME_MATERIALIZE_FAILED"
    assert "secret-cleanup" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_frame_materializer_real_ffmpeg_integration_produces_distinct_frames(tmp_path: Path) -> None:
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
    materializer = FrameMaterializer(
        workspace_root=tmp_path,
        probe_adapter=probe_adapter,
        config=make_config(max_width=160),
    )

    results = materializer.materialize_frames(
        video_path,
        requests=[
            make_request(candidate_id="candidate-001", timestamp_ms=100, selection_reason="early cue"),
            make_request(candidate_id="candidate-002", semantic_moment_id="moment-002", timestamp_ms=900, selection_reason="late cue"),
        ],
    )

    assert len(results) == 2
    assert results[0].sha256 != results[1].sha256
    assert results[0].width <= 160
    assert results[1].width <= 160
    assert results[0].to_manifest()["timestampMs"] == 100
    assert results[1].to_manifest()["timestampMs"] == 900
