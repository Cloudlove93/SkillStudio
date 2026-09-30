from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFilter

import media_worker.frame_quality as frame_quality_module
from media_worker.errors import MediaAdapterError
from media_worker.frame_materializer import MaterializedFrame
from media_worker.frame_quality import FrameQualityAssessor, FrameQualityResult, QualityConfig


def make_config(**overrides: object) -> QualityConfig:
    config_kwargs = {
        "processor_version": "frame-quality-v1",
        "min_sharpness": 0.05,
        "black_pixel_luma": 10,
        "white_pixel_luma": 245,
        "max_black_pixel_ratio": 0.92,
        "max_white_pixel_ratio": 0.92,
        "min_entropy": 0.10,
        "duplicate_hash_distance_max": 1,
        "max_image_pixels": 4_000_000,
        "max_image_bytes": 512 * 1024,
        "max_frames": 48,
        "analysis_max_dimension": 256,
    }
    config_kwargs.update(overrides)
    return QualityConfig(**config_kwargs)


def write_image(path: Path, image: Image.Image) -> None:
    image.save(path, format="PNG")


def stream_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(64 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def build_frame(
    workspace_root: Path,
    *,
    candidate_id: str,
    image: Image.Image,
    timestamp_ms: int,
    semantic_moment_id: str | None = None,
    source_signal: str = "scene_change",
    selection_reason: str = "candidate frame",
) -> MaterializedFrame:
    output_path = workspace_root / f"{candidate_id}.png"
    write_image(output_path, image)
    digest = stream_sha256(output_path)
    return MaterializedFrame(
        candidate_id=candidate_id,
        semantic_moment_id=semantic_moment_id or f"{candidate_id}-moment",
        timestamp_ms=timestamp_ms,
        source_signal=source_signal,
        selection_reason=selection_reason,
        local_path=output_path,
        mime_type="image/png",
        size_bytes=output_path.stat().st_size,
        sha256=digest,
        width=image.width,
        height=image.height,
        ffmpeg_version="8.1.1",
        frame_extractor_version="frame-materializer-v1",
    )


def checkerboard(size: int = 64, block: int = 8) -> Image.Image:
    image = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(image)
    for y in range(0, size, block):
        for x in range(0, size, block):
            if ((x // block) + (y // block)) % 2 == 0:
                draw.rectangle((x, y, x + block - 1, y + block - 1), fill="black")
    return image


def gradient_image(width: int, height: int) -> Image.Image:
    image = Image.new("L", (width, height))
    for x in range(width):
        value = round((x / max(width - 1, 1)) * 255)
        for y in range(height):
            image.putpixel((x, y), value)
    return image.convert("RGB")


def stable_error_parts(error: MediaAdapterError) -> tuple[str | None, str | None]:
    return repr(error.__cause__), repr(error.__context__)


def clone_frame(frame: MaterializedFrame, **overrides: object) -> MaterializedFrame:
    cloned = MaterializedFrame(
        candidate_id=frame.candidate_id,
        semantic_moment_id=frame.semantic_moment_id,
        timestamp_ms=frame.timestamp_ms,
        source_signal=frame.source_signal,
        selection_reason=frame.selection_reason,
        local_path=frame.local_path,
        mime_type=frame.mime_type,
        size_bytes=frame.size_bytes,
        sha256=frame.sha256,
        width=frame.width,
        height=frame.height,
        ffmpeg_version=frame.ffmpeg_version,
        frame_extractor_version=frame.frame_extractor_version,
    )
    for field_name, value in overrides.items():
        object.__setattr__(cloned, field_name, value)
    return cloned


def assert_stable_failure(
    error: MediaAdapterError,
    *,
    forbidden_text: str | None = None,
) -> None:
    if forbidden_text is not None:
        assert forbidden_text not in str(error)
        assert forbidden_text not in repr(error)
    assert stable_error_parts(error) == ("None", "None")


def test_frame_quality_rejects_invalid_config_and_workspace_escape(tmp_path: Path) -> None:
    invalid_configs = [
        {"min_sharpness": -0.1},
        {"min_sharpness": float("nan")},
        {"min_sharpness": float("inf")},
        {"min_sharpness": 2.0},
        {"analysis_max_dimension": True},
        {"analysis_max_dimension": 0},
        {"analysis_max_dimension": 2048},
        {"max_image_pixels": True},
        {"max_image_pixels": 10**100},
        {"max_image_bytes": True},
        {"max_image_bytes": 0},
        {"max_image_bytes": (64 * 1024 * 1024) + 1},
        {"max_frames": True},
        {"max_frames": 0},
        {"max_frames": 49},
        {"duplicate_hash_distance_max": True},
        {"processor_version": "bad version"},
    ]

    for overrides in invalid_configs:
        with pytest.raises(MediaAdapterError) as error_info:
            make_config(**overrides)
        assert error_info.value.code == "FRAME_QUALITY_FAILED"
        assert_stable_failure(error_info.value)

    outside_root = tmp_path.parent / "outside-quality"
    outside_root.mkdir(exist_ok=True)
    outside_frame = build_frame(
        outside_root,
        candidate_id="outside",
        image=checkerboard(),
        timestamp_ms=100,
    )
    assessor = FrameQualityAssessor(workspace_root=tmp_path, config=make_config())

    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([outside_frame])
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value, forbidden_text=str(tmp_path))

    symlink_path = tmp_path / "linked.png"
    try:
        os.symlink(outside_frame.local_path, symlink_path)
    except (OSError, NotImplementedError):
        pytest.skip("symlink creation not available")

    linked_frame = clone_frame(outside_frame, local_path=symlink_path)
    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([linked_frame])
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value, forbidden_text=str(tmp_path))


def test_frame_quality_rejects_invalid_inputs_and_duplicate_candidate_ids(tmp_path: Path) -> None:
    frame = build_frame(tmp_path, candidate_id="candidate-a", image=checkerboard(), timestamp_ms=100)
    second_frame = build_frame(tmp_path, candidate_id="candidate-b", image=checkerboard(), timestamp_ms=200)
    duplicated_candidate = clone_frame(second_frame, candidate_id="candidate-a")
    assessor = FrameQualityAssessor(workspace_root=tmp_path, config=make_config())

    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames("frames")  # type: ignore[arg-type]
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value)

    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([object()])  # type: ignore[list-item]
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value)

    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([frame, duplicated_candidate])
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value)


def test_frame_quality_rejects_frame_count_before_measurement(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    frames = [
        build_frame(tmp_path, candidate_id=f"candidate-{index:03d}", image=checkerboard(), timestamp_ms=index)
        for index in range(49)
    ]
    assessor = FrameQualityAssessor(workspace_root=tmp_path, config=make_config(max_frames=48))
    called = {"measure": False}

    def fail_if_called(*args: object, **kwargs: object):
        called["measure"] = True
        raise AssertionError("measurement should not run")

    monkeypatch.setattr(FrameQualityAssessor, "_measure_frame", fail_if_called)
    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames(frames)
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert called["measure"] is False
    assert_stable_failure(error_info.value)


@pytest.mark.parametrize(
    ("field_name", "field_value"),
    [
        ("mime_type", "image/jpeg"),
        ("size_bytes", 1),
        ("sha256", "f" * 64),
        ("width", 999),
        ("height", 999),
        ("timestamp_ms", True),
    ],
)
def test_frame_quality_rejects_metadata_mismatches(
    tmp_path: Path,
    field_name: str,
    field_value: object,
) -> None:
    frame = build_frame(tmp_path, candidate_id=f"frame-{field_name}", image=checkerboard(), timestamp_ms=100)
    mutated_frame = clone_frame(frame, **{field_name: field_value})
    assessor = FrameQualityAssessor(workspace_root=tmp_path, config=make_config())

    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([mutated_frame])
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value, forbidden_text=str(frame.local_path))


def test_frame_quality_rejects_corrupt_png_and_decompression_bomb_stably(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    corrupt_path = tmp_path / "corrupt.png"
    corrupt_path.write_bytes(b"not-a-png")
    corrupt_frame = MaterializedFrame(
        candidate_id="corrupt",
        semantic_moment_id="corrupt-moment",
        timestamp_ms=100,
        source_signal="scene_change",
        selection_reason="corrupt",
        local_path=corrupt_path,
        mime_type="image/png",
        size_bytes=corrupt_path.stat().st_size,
        sha256=stream_sha256(corrupt_path),
        width=10,
        height=10,
        ffmpeg_version="8.1.1",
        frame_extractor_version="frame-materializer-v1",
    )
    assessor = FrameQualityAssessor(workspace_root=tmp_path, config=make_config())

    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([corrupt_frame])
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value, forbidden_text=str(corrupt_path))

    image_open_frame = build_frame(tmp_path, candidate_id="image-open", image=checkerboard(), timestamp_ms=150)
    original_open = frame_quality_module.Image.open

    def keyerror_open(*args: object, **kwargs: object):
        if args and args[0] == image_open_frame.local_path:
            raise KeyError("secret-local-path")
        return original_open(*args, **kwargs)

    monkeypatch.setattr(frame_quality_module.Image, "open", keyerror_open)
    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([image_open_frame])
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value, forbidden_text="secret-local-path")

    bomb_frame = build_frame(tmp_path, candidate_id="bomb", image=checkerboard(), timestamp_ms=200)
    original_open = frame_quality_module.Image.open

    def exploding_open(*args: object, **kwargs: object):
        if args and args[0] == bomb_frame.local_path:
            raise Image.DecompressionBombError("secret-bomb-path")
        return original_open(*args, **kwargs)

    monkeypatch.setattr(frame_quality_module.Image, "open", exploding_open)
    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([bomb_frame])
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value, forbidden_text="secret-bomb-path")


def test_frame_quality_rejects_byte_limit_before_hash_and_masks_analysis_exceptions(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    frame = build_frame(tmp_path, candidate_id="bytes-limit", image=checkerboard(), timestamp_ms=100)
    too_small_limit = max(1, frame.local_path.stat().st_size - 1)
    assessor = FrameQualityAssessor(
        workspace_root=tmp_path,
        config=make_config(max_image_bytes=too_small_limit),
    )
    hash_called = {"value": False}

    def fail_hash(*args: object, **kwargs: object):
        hash_called["value"] = True
        raise AssertionError("hash should not run")

    monkeypatch.setattr(FrameQualityAssessor, "_sha256_file", fail_hash)
    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([frame])
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert hash_called["value"] is False
    assert_stable_failure(error_info.value)

    analysis_frame = build_frame(tmp_path, candidate_id="analysis-fail", image=checkerboard(), timestamp_ms=200)
    assessor = FrameQualityAssessor(workspace_root=tmp_path, config=make_config())

    def fail_prepare(*args: object, **kwargs: object):
        raise RuntimeError("secret-analysis-path")

    monkeypatch.setattr(FrameQualityAssessor, "_prepare_analysis_image", fail_prepare)
    with pytest.raises(MediaAdapterError) as error_info:
        assessor.assess_frames([analysis_frame])
    assert error_info.value.code == "FRAME_QUALITY_FAILED"
    assert_stable_failure(error_info.value, forbidden_text="secret-analysis-path")


def test_frame_quality_reports_analysis_dimensions_and_json_safe_manifest(tmp_path: Path) -> None:
    large_image = gradient_image(1600, 800)
    frame = build_frame(tmp_path, candidate_id="large", image=large_image, timestamp_ms=100)
    assessor = FrameQualityAssessor(
        workspace_root=tmp_path,
        config=make_config(analysis_max_dimension=128, max_image_pixels=2_000_000),
    )

    result = assessor.assess_frames([frame])[0]
    manifest = result.to_manifest()
    manifest_json = json.dumps(manifest, sort_keys=True)

    assert result.metrics["analysisWidth"] == 128
    assert result.metrics["analysisHeight"] == 64
    assert "localPath" not in manifest_json
    assert str(frame.local_path) not in manifest_json
    assert result.quality_processor_version == "frame-quality-v1"


def test_frame_quality_sharpness_is_zero_for_solid_and_higher_for_sharp_than_blur(tmp_path: Path) -> None:
    solid_frame = build_frame(
        tmp_path,
        candidate_id="solid",
        image=Image.new("RGB", (96, 96), "gray"),
        timestamp_ms=100,
    )
    sharp_frame = build_frame(
        tmp_path,
        candidate_id="sharp",
        image=checkerboard(size=96, block=6),
        timestamp_ms=200,
    )
    blurry_frame = build_frame(
        tmp_path,
        candidate_id="blur",
        image=checkerboard(size=96, block=6).filter(ImageFilter.GaussianBlur(radius=3)),
        timestamp_ms=300,
    )
    assessor = FrameQualityAssessor(workspace_root=tmp_path, config=make_config(min_sharpness=0.0))
    results = {result.candidate_id: result for result in assessor.assess_frames([solid_frame, sharp_frame, blurry_frame])}

    solid_sharpness = float(results["solid"].metrics["sharpness"]["value"])
    sharp_sharpness = float(results["sharp"].metrics["sharpness"]["value"])
    blurry_sharpness = float(results["blur"].metrics["sharpness"]["value"])

    assert solid_sharpness == pytest.approx(0.0, abs=1e-12)
    assert sharp_sharpness > blurry_sharpness
    assert results["sharp"].metrics["sharpness"]["algorithm"] == "laplacian_variance_4_neighbour_normalized"
    assert results["sharp"].metrics["sharpness"]["normalized"] is True


def test_frame_quality_only_deduplicates_within_same_semantic_moment(tmp_path: Path) -> None:
    image = checkerboard(size=96, block=6)
    first = build_frame(
        tmp_path,
        candidate_id="same-a",
        semantic_moment_id="moment-a",
        image=image,
        timestamp_ms=100,
    )
    second = build_frame(
        tmp_path,
        candidate_id="same-b",
        semantic_moment_id="moment-a",
        image=image,
        timestamp_ms=200,
    )
    third = build_frame(
        tmp_path,
        candidate_id="other-moment",
        semantic_moment_id="moment-b",
        image=image,
        timestamp_ms=300,
    )
    assessor = FrameQualityAssessor(
        workspace_root=tmp_path,
        config=make_config(duplicate_hash_distance_max=0, min_sharpness=0.0),
    )
    results = {result.candidate_id: result for result in assessor.assess_frames([third, second, first])}

    assert results["same-a"].duplicate_of is None
    assert results["same-b"].duplicate_of == "same-a"
    assert results["other-moment"].duplicate_of is None


def test_frame_quality_duplicate_suppression_is_greedy_and_non_transitive(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    frames = [
        build_frame(
            tmp_path,
            candidate_id="frame-c",
            semantic_moment_id="moment-a",
            image=checkerboard(),
            timestamp_ms=300,
        ),
        build_frame(
            tmp_path,
            candidate_id="frame-other",
            semantic_moment_id="moment-b",
            image=checkerboard(),
            timestamp_ms=50,
        ),
        build_frame(
            tmp_path,
            candidate_id="frame-b",
            semantic_moment_id="moment-a",
            image=checkerboard(),
            timestamp_ms=200,
        ),
        build_frame(
            tmp_path,
            candidate_id="frame-a",
            semantic_moment_id="moment-a",
            image=checkerboard(),
            timestamp_ms=100,
        ),
    ]
    metrics_by_candidate = {
        "frame-a": ("0000000000000000", 0.95),
        "frame-b": ("0000000000000001", 0.85),
        "frame-c": ("0000000000000003", 0.75),
        "frame-other": ("0000000000000000", 0.99),
    }

    def fake_measure(
        self: FrameQualityAssessor,
        frame: MaterializedFrame,
        frame_path: Path,
    ) -> dict[str, object]:
        duplicate_hash, sharpness = metrics_by_candidate[frame.candidate_id]
        return {
            "analysisWidth": 64,
            "analysisHeight": 64,
            "brightnessMeanNormalized": 0.5,
            "blackPixelRatio": 0.1,
            "whitePixelRatio": 0.1,
            "entropyNormalized": 0.8,
            "sharpness": {
                "algorithm": "laplacian_variance_4_neighbour_normalized",
                "normalized": True,
                "value": sharpness,
            },
            "duplicateHash": {
                "algorithm": "dhash_64",
                "value": duplicate_hash,
            },
        }

    monkeypatch.setattr(FrameQualityAssessor, "_measure_frame", fake_measure)
    assessor = FrameQualityAssessor(
        workspace_root=tmp_path,
        config=make_config(duplicate_hash_distance_max=1, min_sharpness=0.0),
    )
    results = {result.candidate_id: result for result in assessor.assess_frames(frames)}

    assert results["frame-b"].duplicate_of == "frame-a"
    assert results["frame-b"].suppressed is True
    assert results["frame-c"].duplicate_of is None
    assert results["frame-other"].duplicate_of is None

    hashes = {result.candidate_id: str(result.metrics["duplicateHash"]["value"]) for result in results.values()}
    for result in results.values():
        if result.duplicate_of is None:
            continue
        distance = assessor._hamming_distance(hashes[result.candidate_id], hashes[result.duplicate_of])
        assert distance <= assessor.config.duplicate_hash_distance_max
