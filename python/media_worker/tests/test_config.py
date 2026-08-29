from __future__ import annotations

import pytest

from media_worker.config import (
    DEFAULT_ACCEPTED_JOB_TYPES,
    DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    DEFAULT_MAX_MEDIA_DURATION_MS,
    EXECUTOR_MODE_CONTRACT_ONLY_FAKE,
    EXECUTOR_MODE_DISTILLATION,
    EXECUTOR_MODE_MEDIA_QUALITY_CHECK,
    WorkerConfig,
)
from media_worker.errors import WorkerConfigError


BASE_ENV = {
    "MEDIA_WORKER_BASE_URL": "https://worker.test/api",
    "MEDIA_WORKER_SERVICE_TOKEN": "worker-secret-token",
    "MEDIA_WORKER_IDENTITY": "worker-a",
    "MEDIA_WORKER_REQUEST_TIMEOUT_SECONDS": "12.5",
    "MEDIA_WORKER_POLL_INTERVAL_SECONDS": "3.0",
    "MEDIA_WORKER_EXECUTOR_MODE": EXECUTOR_MODE_CONTRACT_ONLY_FAKE,
}


def test_loads_valid_config_and_deduplicates_job_types() -> None:
    config = WorkerConfig.from_env(
        {
            **BASE_ENV,
            "MEDIA_WORKER_ACCEPTED_JOB_TYPES": (
                " transcribe, media_prepare, transcribe, media_quality_check "
            ),
        }
    )

    assert config.base_url == "https://worker.test/api"
    assert config.service_token == "worker-secret-token"
    assert config.worker_identity == "worker-a"
    assert config.request_timeout_seconds == 12.5
    assert config.poll_interval_seconds == 3.0
    assert config.max_idle_poll_interval_seconds == 30.0
    assert config.accepted_job_types == (
        "transcribe",
        "media_prepare",
        "media_quality_check",
    )
    assert config.executor_mode == EXECUTOR_MODE_CONTRACT_ONLY_FAKE
    assert config.max_media_duration_ms == DEFAULT_MAX_MEDIA_DURATION_MS
    assert config.heartbeat_interval_seconds == DEFAULT_HEARTBEAT_INTERVAL_SECONDS


def test_defaults_all_job_types_when_env_omits_accepted_types() -> None:
    config = WorkerConfig.from_env(BASE_ENV)

    assert config.accepted_job_types == DEFAULT_ACCEPTED_JOB_TYPES


@pytest.mark.parametrize(
    ("missing_key", "expected_fragment"),
    [
        ("MEDIA_WORKER_BASE_URL", "MEDIA_WORKER_BASE_URL"),
        ("MEDIA_WORKER_SERVICE_TOKEN", "MEDIA_WORKER_SERVICE_TOKEN"),
        ("MEDIA_WORKER_IDENTITY", "MEDIA_WORKER_IDENTITY"),
        ("MEDIA_WORKER_EXECUTOR_MODE", "MEDIA_WORKER_EXECUTOR_MODE"),
    ],
)
def test_rejects_missing_required_environment_keys(
    missing_key: str, expected_fragment: str
) -> None:
    env = dict(BASE_ENV)
    env.pop(missing_key)

    with pytest.raises(WorkerConfigError, match=expected_fragment):
        WorkerConfig.from_env(env)


@pytest.mark.parametrize(
    "bad_url",
    [
        "ftp://worker.test/api",
        "http://worker.test",
        "http://worker.test/not-api",
        "http://worker.test/api?trace=1",
        "http://worker.test/api#fragment",
        "http://user:pass@worker.test/api",
    ],
)
def test_rejects_invalid_base_url(bad_url: str) -> None:
    with pytest.raises(WorkerConfigError, match="MEDIA_WORKER_BASE_URL"):
        WorkerConfig.from_env({**BASE_ENV, "MEDIA_WORKER_BASE_URL": bad_url})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("MEDIA_WORKER_REQUEST_TIMEOUT_SECONDS", "0"),
        ("MEDIA_WORKER_REQUEST_TIMEOUT_SECONDS", "-1"),
        ("MEDIA_WORKER_REQUEST_TIMEOUT_SECONDS", "nan"),
        ("MEDIA_WORKER_REQUEST_TIMEOUT_SECONDS", "inf"),
        ("MEDIA_WORKER_POLL_INTERVAL_SECONDS", "0"),
        ("MEDIA_WORKER_POLL_INTERVAL_SECONDS", "-1"),
        ("MEDIA_WORKER_POLL_INTERVAL_SECONDS", "nan"),
        ("MEDIA_WORKER_POLL_INTERVAL_SECONDS", "inf"),
        ("MEDIA_WORKER_MAX_IDLE_POLL_INTERVAL_SECONDS", "0"),
        ("MEDIA_WORKER_MAX_IDLE_POLL_INTERVAL_SECONDS", "nan"),
        ("MEDIA_WORKER_MAX_DURATION_MS", "0"),
        ("MEDIA_WORKER_MAX_DURATION_MS", "-1"),
        ("MEDIA_WORKER_MAX_DURATION_MS", "nan"),
        ("MEDIA_WORKER_HEARTBEAT_INTERVAL_SECONDS", "0"),
        ("MEDIA_WORKER_HEARTBEAT_INTERVAL_SECONDS", "-1"),
        ("MEDIA_WORKER_HEARTBEAT_INTERVAL_SECONDS", "nan"),
        ("MEDIA_WORKER_HEARTBEAT_INTERVAL_SECONDS", "inf"),
    ],
)
def test_rejects_invalid_numeric_values(field: str, value: str) -> None:
    with pytest.raises(WorkerConfigError, match=field):
        WorkerConfig.from_env({**BASE_ENV, field: value})


@pytest.mark.parametrize(
    "accepted_types",
    [
        "",
        " , ",
        "transcribe, ingest_media",
    ],
)
def test_rejects_invalid_accepted_job_types(accepted_types: str) -> None:
    with pytest.raises(WorkerConfigError, match="MEDIA_WORKER_ACCEPTED_JOB_TYPES"):
        WorkerConfig.from_env(
            {**BASE_ENV, "MEDIA_WORKER_ACCEPTED_JOB_TYPES": accepted_types}
        )


def test_rejects_unknown_executor_mode() -> None:
    with pytest.raises(WorkerConfigError, match="MEDIA_WORKER_EXECUTOR_MODE"):
        WorkerConfig.from_env(
            {**BASE_ENV, "MEDIA_WORKER_EXECUTOR_MODE": "real_media"}
        )


def test_rejects_max_idle_poll_interval_below_initial_interval() -> None:
    with pytest.raises(
        WorkerConfigError,
        match="MEDIA_WORKER_MAX_IDLE_POLL_INTERVAL_SECONDS",
    ):
        WorkerConfig.from_env(
            {**BASE_ENV, "MEDIA_WORKER_MAX_IDLE_POLL_INTERVAL_SECONDS": "2"}
        )


def test_defaults_real_mode_to_media_quality_check_only() -> None:
    config = WorkerConfig.from_env(
        {
            **BASE_ENV,
            "MEDIA_WORKER_EXECUTOR_MODE": EXECUTOR_MODE_MEDIA_QUALITY_CHECK,
        }
    )

    assert config.accepted_job_types == ("media_quality_check",)


def test_defaults_distillation_mode_to_three_processing_job_types() -> None:
    config = WorkerConfig.from_env(
        {
            **BASE_ENV,
            "MEDIA_WORKER_EXECUTOR_MODE": EXECUTOR_MODE_DISTILLATION,
        }
    )

    assert config.accepted_job_types == (
        "media_prepare",
        "transcribe",
        "frame_materialize",
    )
    assert config.asr_model_name_or_path == "large-v3"
    assert config.asr_manifest_model_id == "faster-whisper-large-v3"
    assert config.asr_device == "auto"
    assert config.asr_compute_type == "default"
    assert config.asr_language is None
    assert config.asr_beam_size == 5


def test_loads_configured_local_asr_runtime_without_exposing_secrets() -> None:
    config = WorkerConfig.from_env(
        {
            **BASE_ENV,
            "MEDIA_WORKER_EXECUTOR_MODE": EXECUTOR_MODE_DISTILLATION,
            "MEDIA_WORKER_ASR_MODEL": "small",
            "MEDIA_WORKER_ASR_MANIFEST_MODEL_ID": "faster-whisper-small",
            "MEDIA_WORKER_ASR_DEVICE": "cpu",
            "MEDIA_WORKER_ASR_COMPUTE_TYPE": "int8",
            "MEDIA_WORKER_ASR_LANGUAGE": "zh",
            "MEDIA_WORKER_ASR_BEAM_SIZE": "3",
        }
    )

    assert config.asr_model_name_or_path == "small"
    assert config.asr_manifest_model_id == "faster-whisper-small"
    assert config.asr_device == "cpu"
    assert config.asr_compute_type == "int8"
    assert config.asr_language == "zh"
    assert config.asr_beam_size == 3


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("MEDIA_WORKER_ASR_MODEL", ""),
        ("MEDIA_WORKER_ASR_MANIFEST_MODEL_ID", "bad model id"),
        ("MEDIA_WORKER_ASR_DEVICE", "cpu\nsecret"),
        ("MEDIA_WORKER_ASR_COMPUTE_TYPE", ""),
        ("MEDIA_WORKER_ASR_LANGUAGE", "中文"),
        ("MEDIA_WORKER_ASR_BEAM_SIZE", "0"),
        ("MEDIA_WORKER_ASR_BEAM_SIZE", "129"),
    ],
)
def test_rejects_invalid_local_asr_runtime(field: str, value: str) -> None:
    with pytest.raises(WorkerConfigError, match=field):
        WorkerConfig.from_env(
            {
                **BASE_ENV,
                "MEDIA_WORKER_EXECUTOR_MODE": EXECUTOR_MODE_DISTILLATION,
                field: value,
            }
        )


def test_rejects_quality_check_job_in_distillation_mode() -> None:
    with pytest.raises(WorkerConfigError, match="MEDIA_WORKER_ACCEPTED_JOB_TYPES"):
        WorkerConfig.from_env(
            {
                **BASE_ENV,
                "MEDIA_WORKER_EXECUTOR_MODE": EXECUTOR_MODE_DISTILLATION,
                "MEDIA_WORKER_ACCEPTED_JOB_TYPES": "media_prepare,media_quality_check",
            }
        )


def test_allows_overriding_media_duration_limit() -> None:
    config = WorkerConfig.from_env(
        {
            **BASE_ENV,
            "MEDIA_WORKER_MAX_DURATION_MS": "60000",
            "MEDIA_WORKER_HEARTBEAT_INTERVAL_SECONDS": "7.5",
        }
    )

    assert config.max_media_duration_ms == 60000
    assert config.heartbeat_interval_seconds == 7.5


def test_rejects_heartbeat_interval_that_cannot_safely_renew_the_sixty_second_lease() -> None:
    with pytest.raises(
        WorkerConfigError,
        match="MEDIA_WORKER_HEARTBEAT_INTERVAL_SECONDS",
    ):
        WorkerConfig.from_env(
            {
                **BASE_ENV,
                "MEDIA_WORKER_HEARTBEAT_INTERVAL_SECONDS": "30.1",
            }
        )


def test_rejects_non_quality_job_types_in_real_mode() -> None:
    with pytest.raises(WorkerConfigError, match="MEDIA_WORKER_ACCEPTED_JOB_TYPES"):
        WorkerConfig.from_env(
            {
                **BASE_ENV,
                "MEDIA_WORKER_EXECUTOR_MODE": EXECUTOR_MODE_MEDIA_QUALITY_CHECK,
                "MEDIA_WORKER_ACCEPTED_JOB_TYPES": "transcribe,media_quality_check",
            }
        )


def test_repr_hides_service_token() -> None:
    config = WorkerConfig.from_env(BASE_ENV)

    assert "worker-secret-token" not in repr(config)
