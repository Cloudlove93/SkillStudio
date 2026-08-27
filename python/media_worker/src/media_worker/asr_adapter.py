from __future__ import annotations

import importlib
import math
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Protocol

from .errors import MediaAdapterError
from .subprocess_support import ensure_workspace_file


MAX_SAFE_INTEGER = 2**53 - 1
SAFE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SAFE_LANGUAGE_PATTERN = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")
SAFE_RUNTIME_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
ALLOWED_ASR_ERROR_CODES = {
    "ASR_BACKEND_UNAVAILABLE",
    "ASR_FAILED",
    "ASR_EMPTY",
    "ASR_LOW_CONFIDENCE",
}


def _stable_error(code: str, message: str) -> MediaAdapterError:
    error = MediaAdapterError(code, message)
    error.__cause__ = None
    error.__context__ = None
    error.__suppress_context__ = True
    return error


def _safe_string(value: object, *, code: str, field_name: str, pattern: re.Pattern[str], allow_none: bool = False) -> str | None:
    if value is None and allow_none:
        return None
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise _stable_error(code, f"{field_name} is invalid")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise _stable_error(code, f"{field_name} is invalid")
    return value


def _runtime_string(value: object, *, code: str, field_name: str, allow_path: bool = False) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _stable_error(code, f"{field_name} is invalid")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise _stable_error(code, f"{field_name} is invalid")
    if allow_path and len(value) > 4096:
        raise _stable_error(code, f"{field_name} is invalid")
    if not allow_path and not SAFE_RUNTIME_PATTERN.fullmatch(value):
        raise _stable_error(code, f"{field_name} is invalid")
    return value


def _positive_int(value: object, *, code: str, field_name: str, minimum: int = 1, maximum: int = MAX_SAFE_INTEGER) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum or value > maximum:
        raise _stable_error(code, f"{field_name} is invalid")
    return value


def _finite_probability(value: object, *, code: str, field_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _stable_error(code, f"{field_name} is invalid")
    numeric: float | None = None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        numeric = None
    if numeric is None:
        raise _stable_error(code, f"{field_name} is invalid")
    if not math.isfinite(numeric) or numeric < 0.0 or numeric > 1.0:
        raise _stable_error(code, f"{field_name} is invalid")
    return numeric


def _finite_number(value: object, *, code: str, field_name: str, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _stable_error(code, f"{field_name} is invalid")
    numeric: float | None = None
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        numeric = None
    if numeric is None:
        raise _stable_error(code, f"{field_name} is invalid")
    if not math.isfinite(numeric):
        raise _stable_error(code, f"{field_name} is invalid")
    if minimum is not None and numeric < minimum:
        raise _stable_error(code, f"{field_name} is invalid")
    return numeric


def _normalize_asr_error_code(error_code: str) -> str:
    if error_code in ALLOWED_ASR_ERROR_CODES:
        return error_code
    return "ASR_FAILED"


def _safe_attribute(obj: object, attribute_name: str, *, code: str, field_name: str) -> object:
    failed = False
    value: object = None
    try:
        value = getattr(obj, attribute_name)
    except Exception:
        failed = True
    if failed:
        raise _stable_error(code, f"{field_name} is invalid")
    return value


class BackendProtocol(Protocol):
    def transcribe(self, audio_path: Path, config: "AsrBackendConfig"):
        ...


@dataclass(frozen=True)
class AsrBackendConfig:
    model_name_or_path: str
    manifest_model_id: str
    device: str
    compute_type: str
    language: str | None
    beam_size: int
    vad_filter: bool
    condition_on_previous_text: bool
    word_timestamps: bool = False

    def __post_init__(self) -> None:
        _runtime_string(self.model_name_or_path, code="ASR_FAILED", field_name="model_name_or_path", allow_path=True)
        _safe_string(
            self.manifest_model_id,
            code="ASR_FAILED",
            field_name="manifest_model_id",
            pattern=SAFE_ID_PATTERN,
        )
        _runtime_string(self.device, code="ASR_FAILED", field_name="device")
        _runtime_string(self.compute_type, code="ASR_FAILED", field_name="compute_type")
        _safe_string(
            self.language,
            code="ASR_FAILED",
            field_name="language",
            pattern=SAFE_LANGUAGE_PATTERN,
            allow_none=True,
        )
        _positive_int(self.beam_size, code="ASR_FAILED", field_name="beam_size", maximum=128)
        if not isinstance(self.vad_filter, bool):
            raise _stable_error("ASR_FAILED", "vad_filter is invalid")
        if not isinstance(self.condition_on_previous_text, bool):
            raise _stable_error("ASR_FAILED", "condition_on_previous_text is invalid")
        if self.word_timestamps is not False:
            raise _stable_error("ASR_FAILED", "word_timestamps is invalid")


@dataclass(frozen=True)
class AsrAdapterConfig:
    backend_config: AsrBackendConfig
    low_confidence_threshold: float
    max_segments: int
    max_segment_characters: int
    max_total_characters: int
    fail_on_low_confidence: bool
    language_probability_threshold: float
    processor_version: str

    def __post_init__(self) -> None:
        if not isinstance(self.backend_config, AsrBackendConfig):
            raise _stable_error("ASR_FAILED", "backend_config is invalid")
        _finite_probability(
            self.low_confidence_threshold,
            code="ASR_FAILED",
            field_name="low_confidence_threshold",
        )
        _positive_int(self.max_segments, code="ASR_FAILED", field_name="max_segments", maximum=100000)
        _positive_int(
            self.max_segment_characters,
            code="ASR_FAILED",
            field_name="max_segment_characters",
            maximum=100000,
        )
        _positive_int(
            self.max_total_characters,
            code="ASR_FAILED",
            field_name="max_total_characters",
            maximum=10000000,
        )
        if self.max_segment_characters > self.max_total_characters:
            raise _stable_error("ASR_FAILED", "max_segment_characters is invalid")
        if not isinstance(self.fail_on_low_confidence, bool):
            raise _stable_error("ASR_FAILED", "fail_on_low_confidence is invalid")
        _finite_probability(
            self.language_probability_threshold,
            code="ASR_FAILED",
            field_name="language_probability_threshold",
        )
        _safe_string(
            self.processor_version,
            code="ASR_FAILED",
            field_name="processor_version",
            pattern=SAFE_ID_PATTERN,
        )


@dataclass(frozen=True)
class AsrTranscriptResult:
    text: str
    segments: list[dict[str, object]]
    duration_ms: int
    backend: str
    model: str
    requested_language: str | None
    detected_language: str | None
    language_probability: float | None
    processor_version: str
    degradations: list[dict[str, str]]

    def to_manifest(self) -> dict[str, object]:
        return {
            "schemaVersion": 1,
            "backend": self.backend,
            "model": self.model,
            "requestedLanguage": self.requested_language,
            "detectedLanguage": self.detected_language,
            "languageProbability": self.language_probability,
            "durationMs": self.duration_ms,
            "segments": self.segments,
            "text": self.text,
            "processorVersion": self.processor_version,
            "degradations": self.degradations,
        }


class SegmentLevelAsrAdapter:
    def __init__(
        self,
        *,
        workspace_root: Path,
        backend: BackendProtocol,
        config: AsrAdapterConfig,
    ) -> None:
        if not isinstance(workspace_root, Path):
            raise _stable_error("ASR_FAILED", "workspace_root is invalid")
        try:
            resolved_workspace = workspace_root.resolve(strict=False)
            workspace_exists = resolved_workspace.exists()
            workspace_is_dir = resolved_workspace.is_dir()
        except Exception:
            resolved_workspace = workspace_root
            workspace_exists = False
            workspace_is_dir = False
            workspace_failed = True
        else:
            workspace_failed = False
        if workspace_failed:
            raise _stable_error("ASR_FAILED", "workspace_root is invalid")
        if not workspace_exists or not workspace_is_dir:
            raise _stable_error("ASR_FAILED", "workspace_root is invalid")
        if not callable(getattr(backend, "transcribe", None)):
            raise _stable_error("ASR_FAILED", "backend is invalid")
        if not isinstance(config, AsrAdapterConfig):
            raise _stable_error("ASR_FAILED", "config is invalid")

        self.workspace_root = resolved_workspace
        self.backend = backend
        self.config = config

    def transcribe_audio(self, audio_path: Path, *, duration_ms: int) -> AsrTranscriptResult:
        validated_duration_ms = _positive_int(
            duration_ms,
            code="ASR_FAILED",
            field_name="duration_ms",
        )
        resolved_audio = ensure_workspace_file(
            self.workspace_root,
            audio_path,
            error_code="ASR_FAILED",
            error_message="Audio input is not accessible",
        )
        backend_error_code: str | None = None
        backend_result = None
        try:
            backend_result = self.backend.transcribe(resolved_audio, self.config.backend_config)
        except MediaAdapterError as error:
            backend_error_code = _normalize_asr_error_code(error.code)
        except Exception:
            backend_error_code = "ASR_FAILED"
        if backend_error_code is not None:
            raise _stable_error(backend_error_code, self._message_for_code(backend_error_code))

        segments_iterable, info = self._unpack_backend_result(backend_result)
        detected_language, language_probability = self._normalize_info(info)

        valid_segments: list[dict[str, object]] = []
        accumulated_text: list[str] = []
        previous_end_ms = 0
        total_characters = 0
        low_confidence_detected = False

        iterator_error_code: str | None = None
        try:
            for raw_index, raw_segment in enumerate(segments_iterable, start=1):
                if raw_index > self.config.max_segments:
                    raise _stable_error("ASR_FAILED", "ASR transcript exceeded limits")
                normalized_segment = self._normalize_segment(
                    raw_segment,
                    duration_ms=validated_duration_ms,
                    previous_end_ms=previous_end_ms,
                    ordinal=len(valid_segments) + 1,
                )
                previous_end_ms = normalized_segment["endMs"]
                text = normalized_segment["text"]
                if not text:
                    continue
                total_characters += len(text)
                if total_characters > self.config.max_total_characters:
                    raise _stable_error("ASR_FAILED", "ASR transcript exceeded limits")
                valid_segments.append(normalized_segment["manifest"])
                accumulated_text.append(text)
                if normalized_segment["lowConfidence"] is True:
                    low_confidence_detected = True
        except MediaAdapterError as error:
            iterator_error_code = _normalize_asr_error_code(error.code)
        except Exception:
            iterator_error_code = "ASR_FAILED"
        if iterator_error_code is not None:
            raise _stable_error(iterator_error_code, self._message_for_code(iterator_error_code))

        if not valid_segments:
            raise _stable_error("ASR_EMPTY", "ASR produced no usable transcript")

        degradations: list[dict[str, str]] = []
        low_language_detected = (
            language_probability is not None
            and language_probability < self.config.language_probability_threshold
        )
        if low_confidence_detected:
            degradations.append(
                {
                    "mode": "low_confidence_segments",
                    "reason": "one_or_more_segments_below_confidence_threshold",
                }
            )
        if low_language_detected:
            degradations.append(
                {
                    "mode": "low_confidence_language",
                    "reason": "detected_language_probability_below_threshold",
                }
            )
        if self.config.fail_on_low_confidence and (low_confidence_detected or low_language_detected):
            raise _stable_error("ASR_LOW_CONFIDENCE", "ASR confidence is too low")

        return AsrTranscriptResult(
            text="\n".join(accumulated_text),
            segments=valid_segments,
            duration_ms=validated_duration_ms,
            backend=self._backend_name(self.backend),
            model=self.config.backend_config.manifest_model_id,
            requested_language=self.config.backend_config.language,
            detected_language=detected_language,
            language_probability=language_probability,
            processor_version=self.config.processor_version,
            degradations=degradations,
        )

    def _unpack_backend_result(self, backend_result: object) -> tuple[Iterable[object], object]:
        if not isinstance(backend_result, (tuple, list)) or len(backend_result) != 2:
            raise _stable_error("ASR_FAILED", "ASR backend returned an invalid result")
        segments_iterable, info = backend_result
        if isinstance(segments_iterable, (str, bytes)):
            raise _stable_error("ASR_FAILED", "ASR backend returned an invalid result")
        iterator_failed = False
        try:
            iter(segments_iterable)
        except TypeError:
            iterator_failed = True
        if iterator_failed:
            raise _stable_error("ASR_FAILED", "ASR backend returned an invalid result")
        return segments_iterable, info

    def _normalize_info(self, info: object) -> tuple[str | None, float | None]:
        language = _safe_attribute(
            info,
            "language",
            code="ASR_FAILED",
            field_name="detected_language",
        )
        detected_language = _safe_string(
            language,
            code="ASR_FAILED",
            field_name="detected_language",
            pattern=SAFE_LANGUAGE_PATTERN,
            allow_none=True,
        )
        language_probability = _safe_attribute(
            info,
            "language_probability",
            code="ASR_FAILED",
            field_name="language_probability",
        )
        if language_probability is None:
            normalized_probability = None
        else:
            normalized_probability = _finite_probability(
                language_probability,
                code="ASR_FAILED",
                field_name="language_probability",
            )
        return detected_language, normalized_probability

    def _normalize_segment(
        self,
        raw_segment: object,
        *,
        duration_ms: int,
        previous_end_ms: int,
        ordinal: int,
    ) -> dict[str, object]:
        start = _finite_number(
            _safe_attribute(raw_segment, "start", code="ASR_FAILED", field_name="start"),
            code="ASR_FAILED",
            field_name="start",
            minimum=0.0,
        )
        end = _finite_number(
            _safe_attribute(raw_segment, "end", code="ASR_FAILED", field_name="end"),
            code="ASR_FAILED",
            field_name="end",
            minimum=0.0,
        )
        if end <= start:
            raise _stable_error("ASR_FAILED", "ASR segment timestamps are invalid")
        duration_seconds = duration_ms / 1000.0
        tolerance_seconds = 0.001
        if start > duration_seconds + tolerance_seconds or end > duration_seconds + tolerance_seconds:
            raise _stable_error("ASR_FAILED", "ASR segment timestamps are invalid")
        start_ms = min(max(int(start * 1000), 0), duration_ms)
        end_ms = min(max(int(end * 1000), 0), duration_ms)
        if start_ms >= end_ms or start_ms < previous_end_ms:
            raise _stable_error("ASR_FAILED", "ASR segment timestamps are invalid")

        text = _safe_attribute(raw_segment, "text", code="ASR_FAILED", field_name="text")
        if not isinstance(text, str):
            raise _stable_error("ASR_FAILED", "ASR segment is invalid")
        stripped_text = text.strip()
        if stripped_text and len(stripped_text) > self.config.max_segment_characters:
            raise _stable_error("ASR_FAILED", "ASR transcript exceeded limits")

        avg_logprob = _finite_number(
            _safe_attribute(raw_segment, "avg_logprob", code="ASR_FAILED", field_name="avg_logprob"),
            code="ASR_FAILED",
            field_name="avg_logprob",
        )
        no_speech_probability = _finite_probability(
            _safe_attribute(raw_segment, "no_speech_prob", code="ASR_FAILED", field_name="no_speech_probability"),
            code="ASR_FAILED",
            field_name="no_speech_probability",
        )
        compression_ratio = _finite_number(
            _safe_attribute(raw_segment, "compression_ratio", code="ASR_FAILED", field_name="compression_ratio"),
            code="ASR_FAILED",
            field_name="compression_ratio",
            minimum=0.0,
        )
        try:
            confidence = math.exp(avg_logprob)
        except OverflowError:
            confidence = float("inf")
        confidence = min(max(confidence, 0.0), 1.0)
        low_confidence = confidence < self.config.low_confidence_threshold

        return {
            "text": stripped_text,
            "endMs": end_ms,
            "lowConfidence": low_confidence,
            "manifest": {
                "id": f"segment-{ordinal:04d}",
                "startMs": start_ms,
                "endMs": end_ms,
                "text": stripped_text,
                "speaker": None,
                "confidence": confidence,
                "confidenceMethod": "exp_avg_logprob_not_calibrated",
                "avgLogProb": avg_logprob,
                "noSpeechProbability": no_speech_probability,
                "compressionRatio": compression_ratio,
                "lowConfidence": low_confidence,
            },
        }

    def _backend_name(self, backend: object) -> str:
        name = backend.__class__.__name__
        if not isinstance(name, str) or not name or len(name) > 128:
            return "unknown"
        if any(ord(character) < 32 or ord(character) == 127 for character in name):
            return "unknown"
        if not re.fullmatch(r"[A-Za-z0-9_]+", name):
            return "unknown"
        if name.endswith("Backend"):
            name = name[:-7]
        parts = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
        return parts if parts and re.fullmatch(r"[a-z0-9_]{1,128}", parts) else "unknown"

    def _message_for_code(self, error_code: str) -> str:
        if error_code == "ASR_BACKEND_UNAVAILABLE":
            return "ASR backend is unavailable"
        if error_code == "ASR_EMPTY":
            return "ASR produced no usable transcript"
        if error_code == "ASR_LOW_CONFIDENCE":
            return "ASR confidence is too low"
        return "ASR backend failed"


class FasterWhisperBackend:
    def __init__(self) -> None:
        self._models: dict[AsrBackendConfig, object] = {}
        self._lock = threading.Lock()

    def transcribe(self, audio_path: Path, config: AsrBackendConfig):
        if not isinstance(config, AsrBackendConfig):
            raise _stable_error("ASR_FAILED", "ASR backend failed")
        module = self._load_module()
        model = self._get_or_create_model(module, config)
        try:
            result = model.transcribe(
                str(audio_path),
                language=config.language,
                beam_size=config.beam_size,
                vad_filter=config.vad_filter,
                condition_on_previous_text=config.condition_on_previous_text,
                word_timestamps=config.word_timestamps,
            )
        except Exception:
            result = None
        if result is None:
            raise _stable_error("ASR_FAILED", "ASR backend failed")
        if not isinstance(result, (tuple, list)) or len(result) != 2:
            raise _stable_error("ASR_FAILED", "ASR backend failed")
        raw_segments, info = result
        if isinstance(raw_segments, (str, bytes)):
            raise _stable_error("ASR_FAILED", "ASR backend failed")
        iterator: Iterator[object] | None = None
        try:
            iterator = iter(raw_segments)
        except TypeError:
            iterator = None
        if iterator is None:
            raise _stable_error("ASR_FAILED", "ASR backend failed")
        return self._wrap_iterator(iterator), info

    def _wrap_iterator(self, iterator: Iterator[object]) -> Iterator[object]:
        while True:
            next_value: object | None = None
            exhausted = False
            failed = False
            try:
                next_value = next(iterator)
            except StopIteration:
                exhausted = True
            except Exception:
                failed = True
            if exhausted:
                return
            if failed:
                raise _stable_error("ASR_FAILED", "ASR backend failed")
            yield next_value

    def _load_module(self):
        module = None
        try:
            module = importlib.import_module("faster_whisper")
        except Exception:
            module = None
        if module is None:
            raise _stable_error("ASR_BACKEND_UNAVAILABLE", "ASR backend is unavailable")
        return module

    def _get_or_create_model(self, module: object, config: AsrBackendConfig):
        with self._lock:
            if config not in self._models:
                model = None
                try:
                    whisper_model = getattr(module, "WhisperModel")
                    model = whisper_model(
                        config.model_name_or_path,
                        device=config.device,
                        compute_type=config.compute_type,
                    )
                except Exception:
                    model = None
                if model is None:
                    raise _stable_error("ASR_BACKEND_UNAVAILABLE", "ASR backend is unavailable")
                self._models[config] = model
            return self._models[config]
