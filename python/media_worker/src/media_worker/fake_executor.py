from __future__ import annotations

import json
import math
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Mapping

from .config import MEDIA_JOB_TYPES
from .errors import FakeExecutionError


def _is_object(value: Any) -> bool:
    return isinstance(value, dict)


def _required_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise FakeExecutionError(
            "INVALID_FAKE_JOB",
            f"{field_name} must be a non-empty string",
        )
    return value.strip()


def _required_positive_integer_string(value: Any, field_name: str) -> str:
    normalized = _required_text(value, field_name)
    if not normalized.isdigit() or int(normalized) <= 0:
        raise FakeExecutionError(
            "INVALID_FAKE_JOB",
            f"{field_name} must be a positive integer string",
        )
    return normalized


def _required_int(value: Any, field_name: str, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise FakeExecutionError(
            "INVALID_FAKE_JOB",
            f"{field_name} must be an integer >= {minimum}",
        )
    return value


@dataclass(frozen=True)
class ClaimedJob:
    job_id: str
    session_id: str
    job_type: str
    attempt_no: int
    max_attempts: int
    input_manifest: dict[str, object]
    progress: dict[str, object]
    lease_token: str
    lease_expires_at: str


@dataclass(frozen=True)
class FakeExecutorResult:
    result_hash: str
    output_manifest: dict[str, object]


def _ecmascript_number(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError("canonical JSON numbers must be finite")
    if value == 0:
        return "0"

    sign = "-" if value < 0 else ""
    absolute = abs(value)
    rendered = repr(absolute)
    if absolute < 1e21 and absolute.is_integer():
        return f"{sign}{int(absolute)}"
    if "e" not in rendered.lower():
        return f"{sign}{rendered}"

    mantissa, raw_exponent = rendered.lower().split("e", 1)
    exponent = int(raw_exponent)
    if 1e-6 <= absolute < 1e21:
        digits = mantissa.replace(".", "")
        decimal_position = 1 + exponent
        if decimal_position <= 0:
            fixed = f"0.{('0' * -decimal_position)}{digits}"
        elif decimal_position >= len(digits):
            fixed = f"{digits}{('0' * (decimal_position - len(digits)))}"
        else:
            fixed = f"{digits[:decimal_position]}.{digits[decimal_position:]}"
        return f"{sign}{fixed}"

    normalized_mantissa = mantissa[:-2] if mantissa.endswith(".0") else mantissa
    exponent_sign = "+" if exponent >= 0 else "-"
    return f"{sign}{normalized_mantissa}e{exponent_sign}{abs(exponent)}"


def _canonicalize(value: object) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _ecmascript_number(value)
    if isinstance(value, list):
        return f"[{','.join(_canonicalize(item) for item in value)}]"
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise TypeError("canonical JSON object keys must be strings")
        pairs = (
            f"{json.dumps(key, ensure_ascii=False)}:{_canonicalize(value[key])}"
            for key in sorted(value)
        )
        return f"{{{','.join(pairs)}}}"
    raise TypeError("value is not JSON-compatible")


def canonical_json(value: Mapping[str, object]) -> str:
    return _canonicalize(value)


def parse_claimed_job(job: Mapping[str, object]) -> ClaimedJob:
    if not _is_object(job):
        raise FakeExecutionError(
            "INVALID_FAKE_JOB",
            "claimed job must be an object",
        )

    job_type = _required_text(job.get("jobType"), "jobType")
    if job_type not in MEDIA_JOB_TYPES:
        raise FakeExecutionError(
            "INVALID_FAKE_JOB",
            "jobType is not supported by the fake executor",
        )

    input_manifest = job.get("inputManifest")
    if not _is_object(input_manifest):
        raise FakeExecutionError(
            "INVALID_FAKE_JOB",
            "inputManifest must be an object",
        )

    progress = job.get("progress")
    if not _is_object(progress):
        raise FakeExecutionError(
            "INVALID_FAKE_JOB",
            "progress must be an object",
        )

    attempt_no = _required_int(job.get("attemptNo"), "attemptNo", 1)
    max_attempts = _required_int(job.get("maxAttempts"), "maxAttempts", 1)
    if attempt_no > max_attempts:
        raise FakeExecutionError(
            "INVALID_FAKE_JOB",
            "attemptNo must be less than or equal to maxAttempts",
        )

    return ClaimedJob(
        job_id=_required_positive_integer_string(job.get("jobId"), "jobId"),
        session_id=_required_positive_integer_string(job.get("sessionId"), "sessionId"),
        job_type=job_type,
        attempt_no=attempt_no,
        max_attempts=max_attempts,
        input_manifest=dict(input_manifest),
        progress=dict(progress),
        lease_token=_required_text(job.get("leaseToken"), "leaseToken"),
        lease_expires_at=_required_text(job.get("leaseExpiresAt"), "leaseExpiresAt"),
    )


class FakeExecutor:
    def run(self, job: Mapping[str, object]) -> FakeExecutorResult:
        claimed_job = parse_claimed_job(job)
        input_manifest_hash = sha256(
            canonical_json(claimed_job.input_manifest).encode("utf-8")
        ).hexdigest()
        output_manifest: dict[str, object] = {
            "processorVersion": "0.1.0-fake",
            "contractOnly": True,
            "jobId": claimed_job.job_id,
            "sessionId": claimed_job.session_id,
            "jobType": claimed_job.job_type,
            "inputManifestHash": input_manifest_hash,
            "objects": [
                {
                    "objectKey": (
                        f"contract-only/skill-sessions/{claimed_job.session_id}/"
                        f"jobs/{claimed_job.job_id}/{claimed_job.job_type}.json"
                    ),
                    "uploaded": False,
                }
            ],
        }
        result_hash = sha256(canonical_json(output_manifest).encode("utf-8")).hexdigest()
        return FakeExecutorResult(result_hash=result_hash, output_manifest=output_manifest)
