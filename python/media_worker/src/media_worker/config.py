from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite
import re
from typing import Mapping
from urllib.parse import urlsplit

from .errors import WorkerConfigError


MEDIA_JOB_TYPES = (
    "media_prepare",
    "transcribe",
    "frame_materialize",
    "media_quality_check",
)
DEFAULT_ACCEPTED_JOB_TYPES = MEDIA_JOB_TYPES
EXECUTOR_MODE_CONTRACT_ONLY_FAKE = "contract_only_fake"
EXECUTOR_MODE_MEDIA_QUALITY_CHECK = "media_quality_check"
EXECUTOR_MODE_DISTILLATION = "distillation"
DEFAULT_MAX_MEDIA_DURATION_MS = 12 * 60 * 60 * 1000
MAX_MEDIA_DURATION_MS_LIMIT = 7 * 24 * 60 * 60 * 1000
DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 15.0
MAX_HEARTBEAT_INTERVAL_SECONDS = 30.0
DEFAULT_MAX_IDLE_POLL_INTERVAL_SECONDS = 30.0
MAX_IDLE_POLL_INTERVAL_SECONDS_LIMIT = 300.0
SAFE_ASR_RUNTIME_PATTERN = re.compile(r"^[^\x00-\x1f\x7f]{1,512}$")
SAFE_ASR_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SAFE_ASR_LANGUAGE_PATTERN = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")


def _required_text(env: Mapping[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise WorkerConfigError(f"{key} is required")
    return value


def _configured_text(
    env: Mapping[str, str], key: str, default: str, pattern: re.Pattern[str]
) -> str:
    value = env.get(key, default).strip()
    if not pattern.fullmatch(value):
        raise WorkerConfigError(f"{key} is invalid")
    return value


def _optional_configured_text(
    env: Mapping[str, str], key: str, pattern: re.Pattern[str]
) -> str | None:
    if key not in env:
        return None
    value = env[key].strip()
    if not pattern.fullmatch(value):
        raise WorkerConfigError(f"{key} is invalid")
    return value


def _positive_finite_float(env: Mapping[str, str], key: str, default: str) -> float:
    raw_value = env.get(key, default).strip()
    try:
        parsed = float(raw_value)
    except ValueError as error:
        raise WorkerConfigError(f"{key} must be a finite positive number") from error
    if not isfinite(parsed) or parsed <= 0:
        raise WorkerConfigError(f"{key} must be a finite positive number")
    return parsed


def _positive_bounded_float(
    env: Mapping[str, str],
    key: str,
    default: str,
    *,
    maximum: float,
) -> float:
    parsed = _positive_finite_float(env, key, default)
    if parsed > maximum:
        raise WorkerConfigError(
            f"{key} must be no greater than {maximum:g}"
        )
    return parsed


def _positive_bounded_int(
    env: Mapping[str, str],
    key: str,
    default: str,
    *,
    maximum: int,
) -> int:
    raw_value = env.get(key, default).strip()
    try:
      parsed = int(raw_value)
    except ValueError as error:
      raise WorkerConfigError(f"{key} must be a positive integer") from error
    if parsed <= 0 or parsed > maximum:
      raise WorkerConfigError(f"{key} must be a positive integer")
    return parsed


def _normalize_base_url(raw_value: str) -> str:
    parsed = urlsplit(raw_value.strip())
    if parsed.scheme not in {"http", "https"}:
        raise WorkerConfigError("MEDIA_WORKER_BASE_URL must use http or https")
    if not parsed.netloc:
        raise WorkerConfigError("MEDIA_WORKER_BASE_URL must include a host")
    if parsed.username or parsed.password:
        raise WorkerConfigError(
            "MEDIA_WORKER_BASE_URL must not include userinfo credentials"
        )
    if parsed.query or parsed.fragment:
        raise WorkerConfigError(
            "MEDIA_WORKER_BASE_URL must not include query or fragment"
        )
    if parsed.path.rstrip("/") != "/api":
        raise WorkerConfigError(
            "MEDIA_WORKER_BASE_URL must point to the explicit /api endpoint"
        )
    return f"{parsed.scheme}://{parsed.netloc}/api"


def _parse_accepted_job_types(
    raw_value: str | None,
    *,
    executor_mode: str,
) -> tuple[str, ...]:
    if raw_value is None:
        if executor_mode == EXECUTOR_MODE_MEDIA_QUALITY_CHECK:
            return ("media_quality_check",)
        if executor_mode == EXECUTOR_MODE_DISTILLATION:
            return ("media_prepare", "transcribe", "frame_materialize")
        return DEFAULT_ACCEPTED_JOB_TYPES

    parsed_values: list[str] = []
    seen: set[str] = set()
    for item in raw_value.split(","):
        normalized = item.strip()
        if not normalized or normalized in seen:
            continue
        if normalized not in MEDIA_JOB_TYPES:
            raise WorkerConfigError(
                "MEDIA_WORKER_ACCEPTED_JOB_TYPES contains an unsupported job type"
            )
        parsed_values.append(normalized)
        seen.add(normalized)

    if not parsed_values:
        raise WorkerConfigError(
            "MEDIA_WORKER_ACCEPTED_JOB_TYPES must contain at least one job type"
        )
    parsed_types = tuple(parsed_values)
    if executor_mode == EXECUTOR_MODE_MEDIA_QUALITY_CHECK and parsed_types != (
        "media_quality_check",
    ):
        raise WorkerConfigError(
            "MEDIA_WORKER_ACCEPTED_JOB_TYPES must equal media_quality_check in real mode"
        )
    if executor_mode == EXECUTOR_MODE_DISTILLATION and any(
        job_type not in {"media_prepare", "transcribe", "frame_materialize"}
        for job_type in parsed_types
    ):
        raise WorkerConfigError(
            "MEDIA_WORKER_ACCEPTED_JOB_TYPES contains a job type unsupported in distillation mode"
        )
    return parsed_types


def _parse_executor_mode(raw_value: str) -> str:
    if raw_value not in {
        EXECUTOR_MODE_CONTRACT_ONLY_FAKE,
        EXECUTOR_MODE_MEDIA_QUALITY_CHECK,
        EXECUTOR_MODE_DISTILLATION,
    }:
        raise WorkerConfigError(
            "MEDIA_WORKER_EXECUTOR_MODE must equal contract_only_fake, media_quality_check, or distillation"
        )
    return raw_value


@dataclass(frozen=True)
class WorkerConfig:
    base_url: str
    service_token: str = field(repr=False)
    worker_identity: str
    request_timeout_seconds: float
    poll_interval_seconds: float
    accepted_job_types: tuple[str, ...]
    executor_mode: str
    max_media_duration_ms: int
    heartbeat_interval_seconds: float
    asr_model_name_or_path: str = "large-v3"
    asr_manifest_model_id: str = "faster-whisper-large-v3"
    asr_device: str = "auto"
    asr_compute_type: str = "default"
    asr_language: str | None = None
    asr_beam_size: int = 5
    max_idle_poll_interval_seconds: float = DEFAULT_MAX_IDLE_POLL_INTERVAL_SECONDS

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "WorkerConfig":
        executor_mode = _parse_executor_mode(
            _required_text(env, "MEDIA_WORKER_EXECUTOR_MODE")
        )
        poll_interval_seconds = _positive_finite_float(
            env,
            "MEDIA_WORKER_POLL_INTERVAL_SECONDS",
            "2",
        )
        max_idle_poll_interval_seconds = _positive_bounded_float(
            env,
            "MEDIA_WORKER_MAX_IDLE_POLL_INTERVAL_SECONDS",
            str(DEFAULT_MAX_IDLE_POLL_INTERVAL_SECONDS),
            maximum=MAX_IDLE_POLL_INTERVAL_SECONDS_LIMIT,
        )
        if max_idle_poll_interval_seconds < poll_interval_seconds:
            raise WorkerConfigError(
                "MEDIA_WORKER_MAX_IDLE_POLL_INTERVAL_SECONDS must be greater than or equal to MEDIA_WORKER_POLL_INTERVAL_SECONDS"
            )
        return cls(
            base_url=_normalize_base_url(_required_text(env, "MEDIA_WORKER_BASE_URL")),
            service_token=_required_text(env, "MEDIA_WORKER_SERVICE_TOKEN"),
            worker_identity=_required_text(env, "MEDIA_WORKER_IDENTITY"),
            request_timeout_seconds=_positive_finite_float(
                env,
                "MEDIA_WORKER_REQUEST_TIMEOUT_SECONDS",
                "10",
            ),
            poll_interval_seconds=poll_interval_seconds,
            accepted_job_types=_parse_accepted_job_types(
                env.get("MEDIA_WORKER_ACCEPTED_JOB_TYPES"),
                executor_mode=executor_mode,
            ),
            executor_mode=executor_mode,
            max_media_duration_ms=_positive_bounded_int(
                env,
                "MEDIA_WORKER_MAX_DURATION_MS",
                str(DEFAULT_MAX_MEDIA_DURATION_MS),
                maximum=MAX_MEDIA_DURATION_MS_LIMIT,
            ),
            heartbeat_interval_seconds=_positive_bounded_float(
                env,
                "MEDIA_WORKER_HEARTBEAT_INTERVAL_SECONDS",
                str(DEFAULT_HEARTBEAT_INTERVAL_SECONDS),
                maximum=MAX_HEARTBEAT_INTERVAL_SECONDS,
            ),
            asr_model_name_or_path=_configured_text(
                env, "MEDIA_WORKER_ASR_MODEL", "large-v3", SAFE_ASR_RUNTIME_PATTERN
            ),
            asr_manifest_model_id=_configured_text(
                env,
                "MEDIA_WORKER_ASR_MANIFEST_MODEL_ID",
                "faster-whisper-large-v3",
                SAFE_ASR_ID_PATTERN,
            ),
            asr_device=_configured_text(
                env, "MEDIA_WORKER_ASR_DEVICE", "auto", SAFE_ASR_ID_PATTERN
            ),
            asr_compute_type=_configured_text(
                env, "MEDIA_WORKER_ASR_COMPUTE_TYPE", "default", SAFE_ASR_ID_PATTERN
            ),
            asr_language=_optional_configured_text(
                env, "MEDIA_WORKER_ASR_LANGUAGE", SAFE_ASR_LANGUAGE_PATTERN
            ),
            asr_beam_size=_positive_bounded_int(
                env, "MEDIA_WORKER_ASR_BEAM_SIZE", "5", maximum=128
            ),
            max_idle_poll_interval_seconds=max_idle_poll_interval_seconds,
        )
