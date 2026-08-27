from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

from media_worker.asr_adapter import (
    AsrAdapterConfig,
    AsrBackendConfig,
    FasterWhisperBackend,
    SegmentLevelAsrAdapter,
)
from media_worker.errors import MediaAdapterError


MAX_SAFE_INTEGER = 2**53 - 1


@dataclass
class FakeSegment:
    start: float
    end: float
    text: str
    avg_logprob: float
    no_speech_prob: float
    compression_ratio: float


@dataclass
class FakeInfo:
    language: str | None
    language_probability: float | None


class RecordingBackend:
    def __init__(
        self,
        *,
        result: object,
        fail_on_call: Exception | None = None,
    ) -> None:
        self.result = result
        self.fail_on_call = fail_on_call
        self.calls: list[tuple[Path, AsrBackendConfig]] = []

    def transcribe(self, audio_path: Path, config: AsrBackendConfig):
        self.calls.append((audio_path, config))
        if self.fail_on_call is not None:
            raise self.fail_on_call
        return self.result


def stable_error_parts(error: MediaAdapterError) -> tuple[str | None, str | None]:
    return repr(error.__cause__), repr(error.__context__)


def make_backend_config(**overrides: object) -> AsrBackendConfig:
    config_kwargs = {
        "model_name_or_path": "C:/models/secret-whisper",
        "manifest_model_id": "whisper-large-v3",
        "device": "cpu",
        "compute_type": "int8",
        "language": "zh",
        "beam_size": 5,
        "vad_filter": True,
        "condition_on_previous_text": False,
        "word_timestamps": False,
    }
    config_kwargs.update(overrides)
    return AsrBackendConfig(**config_kwargs)


def make_adapter_config(**overrides: object) -> AsrAdapterConfig:
    config_kwargs = {
        "backend_config": make_backend_config(),
        "low_confidence_threshold": 0.6,
        "max_segments": 10,
        "max_segment_characters": 40,
        "max_total_characters": 120,
        "fail_on_low_confidence": False,
        "language_probability_threshold": 0.5,
        "processor_version": "asr-adapter-v1",
    }
    config_kwargs.update(overrides)
    return AsrAdapterConfig(**config_kwargs)


def make_adapter(
    tmp_path: Path,
    backend: RecordingBackend,
    **config_overrides: object,
) -> SegmentLevelAsrAdapter:
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    return SegmentLevelAsrAdapter(
        workspace_root=tmp_path,
        backend=backend,
        config=make_adapter_config(**config_overrides),
    )


def test_segment_level_asr_builds_manifest_with_public_model_id_and_low_confidence_degradation(
    tmp_path: Path,
) -> None:
    backend = RecordingBackend(
        result=(
            iter(
                [
                    FakeSegment(0.0, 1.2, "  第一段  ", -0.1, 0.05, 1.1),
                    FakeSegment(1.2, 2.0, "", -0.3, 0.1, 1.0),
                    FakeSegment(2.0, 3.1, "第二段", -1.2, 0.2, 1.3),
                ]
            ),
            FakeInfo(language="zh", language_probability=0.91),
        )
    )
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    adapter = make_adapter(tmp_path, backend)

    result = adapter.transcribe_audio(audio_path, duration_ms=3100)

    assert result.text == "第一段\n第二段"
    assert len(result.segments) == 2
    assert result.segments[0]["id"] == "segment-0001"
    assert result.segments[1]["id"] == "segment-0002"
    assert result.segments[1]["lowConfidence"] is True
    assert result.segments[0]["confidenceMethod"] == "exp_avg_logprob_not_calibrated"
    manifest = result.to_manifest()
    assert manifest["backend"] == "recording"
    assert manifest["requestedLanguage"] == "zh"
    assert manifest["detectedLanguage"] == "zh"
    assert manifest["model"] == "whisper-large-v3"
    assert {
        "mode": "low_confidence_segments",
        "reason": "one_or_more_segments_below_confidence_threshold",
    } in manifest["degradations"]
    assert "secret-whisper" not in str(manifest)
    assert "input.wav" not in str(manifest)

    called_path, called_config = backend.calls[0]
    assert called_path == audio_path
    assert called_config.word_timestamps is False
    assert called_config.vad_filter is True
    assert called_config.beam_size == 5


@pytest.mark.parametrize(
    ("factory", "expected_code"),
    [
        (lambda: make_backend_config(manifest_model_id="bad/path"), "ASR_FAILED"),
        (lambda: make_backend_config(manifest_model_id="bad\x00id"), "ASR_FAILED"),
        (lambda: make_backend_config(beam_size=True), "ASR_FAILED"),
        (lambda: make_backend_config(word_timestamps=True), "ASR_FAILED"),
        (lambda: make_adapter_config(low_confidence_threshold=1.1), "ASR_FAILED"),
        (lambda: make_adapter_config(max_segments=0), "ASR_FAILED"),
        (lambda: make_adapter_config(max_total_characters=False), "ASR_FAILED"),
        (lambda: make_adapter_config(processor_version="bad\nversion"), "ASR_FAILED"),
    ],
)
def test_asr_configs_fail_fast(factory, expected_code: str) -> None:
    with pytest.raises(MediaAdapterError) as error_info:
        factory()
    assert error_info.value.code == expected_code


def test_segment_level_asr_rejects_invalid_duration_runtime_value(tmp_path: Path) -> None:
    backend = RecordingBackend(result=(iter([FakeSegment(0.0, 0.5, "ok", -0.1, 0.1, 1.0)]), FakeInfo("zh", 0.9)))
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    adapter = make_adapter(tmp_path, backend)

    with pytest.raises(MediaAdapterError, match="ASR_FAILED"):
        adapter.transcribe_audio(audio_path, duration_ms=0)


@pytest.mark.parametrize(
    "segments",
    [
        [FakeSegment(float("nan"), 1.0, "bad", -0.1, 0.1, 1.0)],
        [FakeSegment(1.0, 1.0, "bad", -0.1, 0.1, 1.0)],
        [FakeSegment(0.0, 2.0, "too-long", -0.1, 0.1, 1.0)],
        [FakeSegment(0.0004, 0.0008, "tiny", -0.1, 0.1, 1.0)],
        [
            FakeSegment(0.0, 1.0, "ok", -0.1, 0.1, 1.0),
            FakeSegment(0.9, 1.2, "overlap", -0.1, 0.1, 1.0),
        ],
    ],
)
def test_segment_level_asr_rejects_bad_timestamps_and_ms_contract(
    tmp_path: Path,
    segments: list[FakeSegment],
) -> None:
    backend = RecordingBackend(result=(iter(segments), FakeInfo(language="zh", language_probability=0.9)))
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    adapter = make_adapter(tmp_path, backend)

    with pytest.raises(MediaAdapterError, match="ASR_FAILED"):
        adapter.transcribe_audio(audio_path, duration_ms=1000)


def test_segment_level_asr_raw_segment_limit_blocks_empty_text_iterator_escape(tmp_path: Path) -> None:
    backend = RecordingBackend(
        result=(
            iter(
                [
                    FakeSegment(0.0, 0.1, "   ", -0.1, 0.1, 1.0),
                    FakeSegment(0.1, 0.2, "   ", -0.1, 0.1, 1.0),
                    FakeSegment(0.2, 0.3, "内容", -0.1, 0.1, 1.0),
                ]
            ),
            FakeInfo(language="zh", language_probability=0.9),
        )
    )
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    adapter = make_adapter(tmp_path, backend, max_segments=2)

    with pytest.raises(MediaAdapterError, match="ASR_FAILED"):
        adapter.transcribe_audio(audio_path, duration_ms=1000)


@pytest.mark.parametrize(
    "segment",
    [
        FakeSegment(0.0, 1.0, "内容", -0.1, 1.2, 1.0),
        FakeSegment(0.0, 1.0, "内容", -0.1, -0.1, 1.0),
        FakeSegment(0.0, 1.0, "内容", -0.1, 0.1, -0.1),
        FakeSegment(0.0, 1.0, "内容", float("nan"), 0.1, 1.0),
    ],
)
def test_segment_level_asr_rejects_invalid_backend_metrics(tmp_path: Path, segment: FakeSegment) -> None:
    backend = RecordingBackend(result=(iter([segment]), FakeInfo(language="zh", language_probability=0.9)))
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    adapter = make_adapter(tmp_path, backend)

    with pytest.raises(MediaAdapterError, match="ASR_FAILED"):
        adapter.transcribe_audio(audio_path, duration_ms=1000)


def test_segment_level_asr_maps_info_shape_error_to_stable_failure(tmp_path: Path) -> None:
    backend = RecordingBackend(
        result=(iter([FakeSegment(0.0, 1.0, "内容", -0.1, 0.1, 1.0)]), FakeInfo(language="zh", language_probability="bad"))  # type: ignore[arg-type]
    )
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    adapter = make_adapter(tmp_path, backend)

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.transcribe_audio(audio_path, duration_ms=1000)

    error = error_info.value
    assert error.code == "ASR_FAILED"
    assert stable_error_parts(error) == ("None", "None")


def test_segment_level_asr_handles_low_language_confidence_and_fail_fast_option(tmp_path: Path) -> None:
    backend = RecordingBackend(
        result=([FakeSegment(0.0, 1.0, "内容", -0.1, 0.1, 1.0)], FakeInfo(language="zh", language_probability=0.2))
    )
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    adapter = make_adapter(tmp_path, backend)
    result = adapter.transcribe_audio(audio_path, duration_ms=1000)
    assert {
        "mode": "low_confidence_language",
        "reason": "detected_language_probability_below_threshold",
    } in result.degradations

    strict_adapter = make_adapter(tmp_path, backend, fail_on_low_confidence=True)
    with pytest.raises(MediaAdapterError, match="ASR_LOW_CONFIDENCE"):
        strict_adapter.transcribe_audio(audio_path, duration_ms=1000)


def test_segment_level_asr_fail_on_low_confidence_segments_when_enabled(tmp_path: Path) -> None:
    backend = RecordingBackend(
        result=(iter([FakeSegment(0.0, 1.0, "内容", -2.0, 0.1, 1.0)]), FakeInfo(language="zh", language_probability=0.9))
    )
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    strict_adapter = make_adapter(tmp_path, backend, fail_on_low_confidence=True)

    with pytest.raises(MediaAdapterError, match="ASR_LOW_CONFIDENCE"):
        strict_adapter.transcribe_audio(audio_path, duration_ms=1000)


def test_segment_level_asr_rejects_bad_backend_shape_and_hides_secrets(tmp_path: Path) -> None:
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")

    adapter = SegmentLevelAsrAdapter(
        workspace_root=tmp_path,
        backend=RecordingBackend(result="bad-shape"),
        config=make_adapter_config(),
    )
    with pytest.raises(MediaAdapterError) as error_info:
        adapter.transcribe_audio(audio_path, duration_ms=1000)
    assert error_info.value.code == "ASR_FAILED"
    assert stable_error_parts(error_info.value) == ("None", "None")

    exploding_adapter = SegmentLevelAsrAdapter(
        workspace_root=tmp_path,
        backend=RecordingBackend(result=None, fail_on_call=RuntimeError("secret-backend-path")),
        config=make_adapter_config(),
    )
    with pytest.raises(MediaAdapterError) as error_info:
        exploding_adapter.transcribe_audio(audio_path, duration_ms=1000)
    assert error_info.value.code == "ASR_FAILED"
    assert "secret-backend-path" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_segment_level_asr_masks_iter_and_info_getter_failures(tmp_path: Path) -> None:
    class BadIterable:
        def __iter__(self):
            raise TypeError("secret-iter-shape")

    class ExplodingInfo:
        @property
        def language(self):
            raise RuntimeError("secret-info-language")

        @property
        def language_probability(self):
            return 0.9

    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")

    adapter = SegmentLevelAsrAdapter(
        workspace_root=tmp_path,
        backend=RecordingBackend(result=(BadIterable(), FakeInfo("zh", 0.9))),
        config=make_adapter_config(),
    )
    with pytest.raises(MediaAdapterError) as error_info:
        adapter.transcribe_audio(audio_path, duration_ms=1000)
    assert error_info.value.code == "ASR_FAILED"
    assert "secret-iter-shape" not in str(error_info.value)
    assert "secret-iter-shape" not in repr(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")

    adapter = SegmentLevelAsrAdapter(
        workspace_root=tmp_path,
        backend=RecordingBackend(
            result=([FakeSegment(0.0, 1.0, "内容", -0.1, 0.1, 1.0)], ExplodingInfo())
        ),
        config=make_adapter_config(),
    )
    with pytest.raises(MediaAdapterError) as error_info:
        adapter.transcribe_audio(audio_path, duration_ms=1000)
    assert error_info.value.code == "ASR_FAILED"
    assert "secret-info-language" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_segment_level_asr_rejects_unknown_backend_error_codes(tmp_path: Path) -> None:
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    adapter = SegmentLevelAsrAdapter(
        workspace_root=tmp_path,
        backend=RecordingBackend(
            result=None,
            fail_on_call=MediaAdapterError("SECRET_CODE", "secret-message"),
        ),
        config=make_adapter_config(),
    )

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.transcribe_audio(audio_path, duration_ms=1000)

    assert error_info.value.code == "ASR_FAILED"
    assert "SECRET_CODE" not in str(error_info.value)
    assert "secret-message" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")


def test_segment_level_asr_configuration_limits_and_backend_name_safety(tmp_path: Path) -> None:
    with pytest.raises(MediaAdapterError, match="ASR_FAILED"):
        make_backend_config(model_name_or_path="a" * 4097)
    with pytest.raises(MediaAdapterError, match="ASR_FAILED"):
        make_adapter_config(max_segment_characters=100001)
    with pytest.raises(MediaAdapterError, match="ASR_FAILED"):
        make_adapter_config(max_total_characters=10000001)
    with pytest.raises(MediaAdapterError, match="ASR_FAILED"):
        make_adapter_config(max_segment_characters=500, max_total_characters=100)

    BadBackendName = type(
        "Bad/Backend",
        (),
        {
            "transcribe": lambda self, audio_path, config: (
                [FakeSegment(0.0, 1.0, "内容", -0.1, 0.1, 1.0)],
                FakeInfo("zh", 0.9),
            )
        },
    )
    backend = BadBackendName()
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    adapter = SegmentLevelAsrAdapter(
        workspace_root=tmp_path,
        backend=backend,  # type: ignore[arg-type]
        config=make_adapter_config(),
    )
    assert adapter.transcribe_audio(audio_path, duration_ms=1000).backend == "unknown"


def test_faster_whisper_backend_is_lazy_and_caches_by_full_config(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    created_models: list[tuple[str, str, str]] = []

    class FakeWhisperModel:
        def __init__(self, model_name: str, device: str, compute_type: str) -> None:
            created_models.append((model_name, device, compute_type))

        def transcribe(self, audio_path: str, **kwargs: object):
            assert kwargs["word_timestamps"] is False
            return iter([FakeSegment(0.0, 1.0, "内容", -0.1, 0.1, 1.0)]), FakeInfo(
                language="zh",
                language_probability=0.8,
            )

    class FakeModule:
        WhisperModel = FakeWhisperModel

    backend = FasterWhisperBackend()
    monkeypatch.setattr(
        "importlib.import_module",
        lambda name: FakeModule() if name == "faster_whisper" else None,
    )

    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")
    config_a = make_backend_config()
    config_b = make_backend_config(device="cuda")

    backend.transcribe(audio_path, config_a)
    backend.transcribe(audio_path, config_a)
    backend.transcribe(audio_path, config_b)

    assert created_models == [
        ("C:/models/secret-whisper", "cpu", "int8"),
        ("C:/models/secret-whisper", "cuda", "int8"),
    ]


def test_faster_whisper_backend_reports_missing_dependency_and_hides_exception_chain(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    backend = FasterWhisperBackend()
    monkeypatch.setattr(
        "importlib.import_module",
        lambda name: (_ for _ in ()).throw(ImportError("missing secret-whisper")),
    )
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")

    with pytest.raises(MediaAdapterError) as error_info:
        backend.transcribe(audio_path, make_backend_config())

    error = error_info.value
    assert error.code == "ASR_BACKEND_UNAVAILABLE"
    assert "secret-whisper" not in str(error)
    assert stable_error_parts(error) == ("None", "None")


def test_faster_whisper_backend_masks_runtime_and_delayed_iterator_exceptions(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    class ExplodingModel:
        def __init__(self, model_name: str, device: str, compute_type: str) -> None:
            pass

        def transcribe(self, audio_path: str, **kwargs: object):
            raise RuntimeError("secret-whisper-call")

    class LateIteratorModel:
        def __init__(self, model_name: str, device: str, compute_type: str) -> None:
            pass

        def transcribe(self, audio_path: str, **kwargs: object):
            def iterator():
                yield FakeSegment(0.0, 1.0, "内容", -0.1, 0.1, 1.0)
                raise RuntimeError("secret-late-iterator")

            return iterator(), FakeInfo(language="zh", language_probability=0.9)

    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"fake-audio")

    class ExplodingModule:
        WhisperModel = ExplodingModel

    backend = FasterWhisperBackend()
    monkeypatch.setattr(
        "importlib.import_module",
        lambda name: ExplodingModule() if name == "faster_whisper" else None,
    )
    with pytest.raises(MediaAdapterError) as error_info:
        backend.transcribe(audio_path, make_backend_config())
    assert error_info.value.code == "ASR_FAILED"
    assert "secret-whisper-call" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")

    class LateIteratorModule:
        WhisperModel = LateIteratorModel

    backend = FasterWhisperBackend()
    monkeypatch.setattr(
        "importlib.import_module",
        lambda name: LateIteratorModule() if name == "faster_whisper" else None,
    )
    segments, _info = backend.transcribe(audio_path, make_backend_config())
    assert next(iter(segments)).text == "内容"
    with pytest.raises(MediaAdapterError) as error_info:
        next(iter(segments))
    assert error_info.value.code == "ASR_FAILED"
    assert "secret-late-iterator" not in str(error_info.value)
    assert stable_error_parts(error_info.value) == ("None", "None")
