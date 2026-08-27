from __future__ import annotations

import hashlib
import math
import re
import threading
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from PIL import Image, UnidentifiedImageError

from .errors import MediaAdapterError
from .frame_materializer import MaterializedFrame
from .subprocess_support import ensure_workspace_file


SAFE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
MAX_PROCESSOR_VERSION_LENGTH = 128
MAX_SAFE_INTEGER = 2**53 - 1
MAX_IMAGE_PIXELS_HARD_LIMIT = 64_000_000
MAX_IMAGE_BYTES_HARD_LIMIT = 64 * 1024 * 1024
MAX_ANALYSIS_DIMENSION = 1024
_PIL_IMAGE_PIXELS_LOCK = threading.Lock()


def _stable_error(code: str, message: str) -> MediaAdapterError:
    error = MediaAdapterError(code, message)
    error.__cause__ = None
    error.__context__ = None
    error.__suppress_context__ = True
    return error


def _positive_int(value: object, *, field_name: str, minimum: int = 1, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise _stable_error("FRAME_QUALITY_FAILED", f"{field_name} is invalid")
    if maximum is not None and value > maximum:
        raise _stable_error("FRAME_QUALITY_FAILED", f"{field_name} is invalid")
    return value


def _finite_ratio(value: object, *, field_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _stable_error("FRAME_QUALITY_FAILED", f"{field_name} is invalid")
    numeric: float | None = None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        numeric = None
    if numeric is None or not math.isfinite(numeric) or numeric < 0.0 or numeric > 1.0:
        raise _stable_error("FRAME_QUALITY_FAILED", f"{field_name} is invalid")
    return numeric


def _safe_identifier(value: object, *, field_name: str, maximum_length: int = MAX_PROCESSOR_VERSION_LENGTH) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum_length:
        raise _stable_error("FRAME_QUALITY_FAILED", f"{field_name} is invalid")
    if not SAFE_ID_PATTERN.fullmatch(value):
        raise _stable_error("FRAME_QUALITY_FAILED", f"{field_name} is invalid")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise _stable_error("FRAME_QUALITY_FAILED", f"{field_name} is invalid")
    return value


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


@dataclass(frozen=True)
class QualityConfig:
    processor_version: str
    min_sharpness: float
    black_pixel_luma: int
    white_pixel_luma: int
    max_black_pixel_ratio: float
    max_white_pixel_ratio: float
    min_entropy: float
    duplicate_hash_distance_max: int
    max_image_pixels: int
    max_image_bytes: int
    max_frames: int
    analysis_max_dimension: int

    def __post_init__(self) -> None:
        _safe_identifier(
            self.processor_version,
            field_name="processor_version",
        )
        _finite_ratio(self.min_sharpness, field_name="min_sharpness")
        _positive_int(self.black_pixel_luma, field_name="black_pixel_luma", minimum=0, maximum=255)
        _positive_int(self.white_pixel_luma, field_name="white_pixel_luma", minimum=0, maximum=255)
        if self.black_pixel_luma >= self.white_pixel_luma:
            raise _stable_error("FRAME_QUALITY_FAILED", "white_pixel_luma is invalid")
        _finite_ratio(self.max_black_pixel_ratio, field_name="max_black_pixel_ratio")
        _finite_ratio(self.max_white_pixel_ratio, field_name="max_white_pixel_ratio")
        _finite_ratio(self.min_entropy, field_name="min_entropy")
        _positive_int(
            self.duplicate_hash_distance_max,
            field_name="duplicate_hash_distance_max",
            minimum=0,
            maximum=64,
        )
        _positive_int(
            self.max_image_pixels,
            field_name="max_image_pixels",
            maximum=MAX_IMAGE_PIXELS_HARD_LIMIT,
        )
        _positive_int(
            self.max_image_bytes,
            field_name="max_image_bytes",
            maximum=MAX_IMAGE_BYTES_HARD_LIMIT,
        )
        _positive_int(
            self.max_frames,
            field_name="max_frames",
            maximum=48,
        )
        _positive_int(
            self.analysis_max_dimension,
            field_name="analysis_max_dimension",
            maximum=MAX_ANALYSIS_DIMENSION,
        )


@dataclass
class FrameQualityResult:
    candidate_id: str
    semantic_moment_id: str
    timestamp_ms: int
    source_signal: str
    selection_reason: str
    metrics: dict[str, object]
    hard_rejected_reasons: list[str]
    duplicate_of: str | None
    suppressed: bool
    degradations: list[dict[str, str]]
    quality_processor_version: str

    def to_manifest(self) -> dict[str, object]:
        return {
            "candidateId": self.candidate_id,
            "semanticMomentId": self.semantic_moment_id,
            "timestampMs": self.timestamp_ms,
            "sourceSignal": self.source_signal,
            "selectionReason": self.selection_reason,
            "metrics": self.metrics,
            "hardRejectedReasons": self.hard_rejected_reasons,
            "duplicateOf": self.duplicate_of,
            "suppressed": self.suppressed,
            "degradations": self.degradations,
            "qualityProcessorVersion": self.quality_processor_version,
        }


class FrameQualityAssessor:
    def __init__(self, *, workspace_root: Path, config: QualityConfig) -> None:
        if not isinstance(workspace_root, Path):
            raise _stable_error("FRAME_QUALITY_FAILED", "workspace_root is invalid")
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
            raise _stable_error("FRAME_QUALITY_FAILED", "workspace_root is invalid")
        if not isinstance(config, QualityConfig):
            raise _stable_error("FRAME_QUALITY_FAILED", "config is invalid")
        self.workspace_root = resolved_workspace
        self.config = config

    def assess_frames(self, frames: Sequence[MaterializedFrame]) -> list[FrameQualityResult]:
        if isinstance(frames, (str, bytes)) or not isinstance(frames, Sequence):
            raise _stable_error("FRAME_QUALITY_FAILED", "frames are invalid")
        sequence_failed = False
        try:
            frame_count = len(frames)
            validated_frames = list(frames)
        except Exception:
            sequence_failed = True
            frame_count = 0
            validated_frames = []
        if sequence_failed or frame_count == 0 or len(validated_frames) != frame_count:
            raise _stable_error("FRAME_QUALITY_FAILED", "frames are invalid")
        if frame_count > self.config.max_frames:
            raise _stable_error("FRAME_QUALITY_FAILED", "frames are invalid")

        candidate_ids: set[str] = set()
        results: list[FrameQualityResult] = []
        for frame in validated_frames:
            if not isinstance(frame, MaterializedFrame):
                raise _stable_error("FRAME_QUALITY_FAILED", "frame is invalid")
            if frame.candidate_id in candidate_ids:
                raise _stable_error("FRAME_QUALITY_FAILED", "candidate_id must be unique")
            candidate_ids.add(frame.candidate_id)
            resolved_path = ensure_workspace_file(
                self.workspace_root,
                frame.local_path,
                error_code="FRAME_QUALITY_FAILED",
                error_message="Frame input is not accessible",
            )
            metrics = self._measure_frame(frame, resolved_path)
            hard_rejected_reasons = self._hard_rejected_reasons(metrics)
            results.append(
                FrameQualityResult(
                    candidate_id=frame.candidate_id,
                    semantic_moment_id=frame.semantic_moment_id,
                    timestamp_ms=frame.timestamp_ms,
                    source_signal=frame.source_signal,
                    selection_reason=frame.selection_reason,
                    metrics=metrics,
                    hard_rejected_reasons=hard_rejected_reasons,
                    duplicate_of=None,
                    suppressed=False,
                    degradations=[
                        {
                            "mode": "transition_stability_not_evaluated",
                            "reason": "g1_quality_skipped_neighbor_frame_sampling",
                        }
                    ],
                    quality_processor_version=self.config.processor_version,
                )
            )
        self._apply_duplicate_suppression(results)
        return results

    def _measure_frame(self, frame: MaterializedFrame, frame_path: Path) -> dict[str, object]:
        measure_failed = False
        metrics: dict[str, object] | None = None
        try:
            metrics = self._measure_frame_impl(frame, frame_path)
        except Exception:
            measure_failed = True
        if measure_failed or metrics is None:
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")
        return metrics

    def _measure_frame_impl(self, frame: MaterializedFrame, frame_path: Path) -> dict[str, object]:
        self._validate_frame_metadata(frame)

        stat_failed = False
        actual_size_bytes = 0
        try:
            actual_size_bytes = frame_path.stat().st_size
        except Exception:
            stat_failed = True
        if (
            stat_failed
            or actual_size_bytes <= 0
            or actual_size_bytes != frame.size_bytes
            or actual_size_bytes > self.config.max_image_bytes
            or actual_size_bytes > MAX_SAFE_INTEGER
        ):
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")

        hash_failed = False
        actual_sha256: str | None = None
        try:
            actual_sha256 = self._sha256_file(frame_path)
        except MediaAdapterError:
            hash_failed = True
        except Exception:
            hash_failed = True
        if hash_failed or actual_sha256 != frame.sha256:
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")

        decode_failed = False
        decoded_image: Image.Image | None = None
        actual_width = 0
        actual_height = 0
        actual_format: str | None = None
        with _PIL_IMAGE_PIXELS_LOCK:
            previous_max_pixels = Image.MAX_IMAGE_PIXELS
            try:
                Image.MAX_IMAGE_PIXELS = self.config.max_image_pixels
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(frame_path) as image:
                        image.verify()
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(frame_path) as image:
                        image.load()
                        actual_format = image.format
                        actual_width, actual_height = image.size
                        decoded_image = image.copy()
            except (
                OSError,
                RuntimeError,
                ValueError,
                OverflowError,
                UnidentifiedImageError,
                Image.DecompressionBombError,
                Image.DecompressionBombWarning,
            ):
                decode_failed = True
            finally:
                Image.MAX_IMAGE_PIXELS = previous_max_pixels
        if decode_failed or decoded_image is None:
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")

        if actual_format != "PNG":
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")
        if actual_width != frame.width or actual_height != frame.height:
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")
        if actual_width <= 0 or actual_height <= 0:
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")
        if actual_width * actual_height > self.config.max_image_pixels:
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")

        analysis_image = self._prepare_analysis_image(decoded_image)
        grayscale = analysis_image.convert("L")
        pixels = list(grayscale.tobytes())
        total_pixels = len(pixels)
        if total_pixels == 0:
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")

        brightness = sum(pixels) / (255.0 * total_pixels)
        black_pixel_ratio = sum(1 for pixel in pixels if pixel <= self.config.black_pixel_luma) / total_pixels
        white_pixel_ratio = sum(1 for pixel in pixels if pixel >= self.config.white_pixel_luma) / total_pixels

        histogram = grayscale.histogram()
        entropy = 0.0
        for count in histogram:
            if count == 0:
                continue
            probability = count / total_pixels
            entropy -= probability * math.log2(probability)
        normalized_entropy = entropy / 8.0

        sharpness = self._normalized_sharpness(grayscale, pixels)
        duplicate_hash = self._dhash_64(grayscale)
        return {
            "analysisWidth": analysis_image.width,
            "analysisHeight": analysis_image.height,
            "brightnessMeanNormalized": brightness,
            "blackPixelRatio": black_pixel_ratio,
            "whitePixelRatio": white_pixel_ratio,
            "entropyNormalized": normalized_entropy,
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

    def _validate_frame_metadata(self, frame: MaterializedFrame) -> None:
        if frame.mime_type != "image/png":
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")
        if not isinstance(frame.sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", frame.sha256):
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")
        for field_name in ("size_bytes", "width", "height"):
            value = getattr(frame, field_name)
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > MAX_SAFE_INTEGER:
                raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")
        if (
            isinstance(frame.timestamp_ms, bool)
            or not isinstance(frame.timestamp_ms, int)
            or frame.timestamp_ms < 0
            or frame.timestamp_ms > MAX_SAFE_INTEGER
        ):
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")

    def _prepare_analysis_image(self, image: Image.Image) -> Image.Image:
        width, height = image.size
        longest_edge = max(width, height)
        if longest_edge <= self.config.analysis_max_dimension:
            return image.copy()
        scale = self.config.analysis_max_dimension / longest_edge
        new_width = max(1, round(width * scale))
        new_height = max(1, round(height * scale))
        return image.resize((new_width, new_height), Image.Resampling.BILINEAR)

    def _normalized_sharpness(self, grayscale: Image.Image, pixels: list[int]) -> float:
        width, height = grayscale.size
        if width < 3 or height < 3:
            return 0.0
        laplacians: list[float] = []
        for y in range(1, height - 1):
            row_index = y * width
            for x in range(1, width - 1):
                pixel_index = row_index + x
                center = pixels[pixel_index]
                laplacian = (
                    pixels[pixel_index - width]
                    + pixels[pixel_index + width]
                    + pixels[pixel_index - 1]
                    + pixels[pixel_index + 1]
                    - (4 * center)
                )
                laplacians.append(float(laplacian))
        if not laplacians:
            return 0.0
        mean = sum(laplacians) / len(laplacians)
        variance = sum((value - mean) ** 2 for value in laplacians) / len(laplacians)
        normalized = variance / float((4 * 255) ** 2)
        return _clamp(normalized, 0.0, 1.0)

    def _hard_rejected_reasons(self, metrics: dict[str, object]) -> list[str]:
        reasons: list[str] = []
        sharpness = float(metrics["sharpness"]["value"])
        black_ratio = float(metrics["blackPixelRatio"])
        white_ratio = float(metrics["whitePixelRatio"])
        entropy = float(metrics["entropyNormalized"])
        if sharpness < self.config.min_sharpness:
            reasons.append("blurry")
        if black_ratio > self.config.max_black_pixel_ratio:
            reasons.append("black_screen")
        if white_ratio > self.config.max_white_pixel_ratio:
            reasons.append("white_screen")
        if entropy < self.config.min_entropy:
            reasons.append("low_information")
        return reasons

    def _apply_duplicate_suppression(self, results: list[FrameQualityResult]) -> None:
        if len(results) < 2:
            return
        groups: dict[str, list[int]] = {}
        for index, result in enumerate(results):
            groups.setdefault(result.semantic_moment_id, []).append(index)

        for group_indexes in groups.values():
            if len(group_indexes) < 2:
                continue
            ranked_indexes = sorted(group_indexes, key=lambda index: self._quality_rank(results[index]))
            keeper_indexes: list[int] = []
            for index in ranked_indexes:
                candidate_hash = str(results[index].metrics["duplicateHash"]["value"])
                duplicate_keeper_index: int | None = None
                for keeper_index in keeper_indexes:
                    keeper_hash = str(results[keeper_index].metrics["duplicateHash"]["value"])
                    if self._hamming_distance(candidate_hash, keeper_hash) <= self.config.duplicate_hash_distance_max:
                        duplicate_keeper_index = keeper_index
                        break
                if duplicate_keeper_index is None:
                    keeper_indexes.append(index)
                    continue
                results[index].duplicate_of = results[duplicate_keeper_index].candidate_id
                results[index].suppressed = True

    def _quality_rank(self, result: FrameQualityResult) -> tuple[float, float, float, float, int, str]:
        brightness = float(result.metrics["brightnessMeanNormalized"])
        sharpness = float(result.metrics["sharpness"]["value"])
        entropy = float(result.metrics["entropyNormalized"])
        return (
            0.0 if not result.hard_rejected_reasons else 1.0,
            -sharpness,
            -entropy,
            abs(brightness - 0.5),
            result.timestamp_ms,
            result.candidate_id,
        )

    def _dhash_64(self, grayscale: Image.Image) -> str:
        resized = grayscale.resize((9, 8), Image.Resampling.BILINEAR)
        pixels = list(resized.tobytes())
        bits = 0
        for row in range(8):
            for column in range(8):
                left = pixels[row * 9 + column]
                right = pixels[row * 9 + column + 1]
                bits = (bits << 1) | (1 if left > right else 0)
        return f"{bits:016x}"

    def _hamming_distance(self, left_hash: str, right_hash: str) -> int:
        return (int(left_hash, 16) ^ int(right_hash, 16)).bit_count()

    def _sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        read_failed = False
        try:
            with path.open("rb") as stream:
                while True:
                    chunk = stream.read(64 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
        except Exception:
            read_failed = True
        if read_failed:
            raise _stable_error("FRAME_QUALITY_FAILED", "Frame quality evaluation failed")
        return digest.hexdigest()
