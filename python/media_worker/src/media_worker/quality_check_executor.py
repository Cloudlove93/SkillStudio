from __future__ import annotations

import json
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol

import httpx

from .errors import MediaAdapterError, QualityCheckExecutionError
from .fake_executor import FakeExecutorResult, canonical_json
from .ffprobe_adapter import FfprobeAdapter, MediaProbeResult


PROCESSOR_VERSION = "0.1.0"


def _is_object(value: Any) -> bool:
    return isinstance(value, dict)


def _stable_error(
    code: str,
    message: str,
    *,
    retryable: bool,
) -> QualityCheckExecutionError:
    error = QualityCheckExecutionError(code, message, retryable=retryable)
    error.__cause__ = None
    error.__context__ = None
    error.__suppress_context__ = True
    return error


def _required_text(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", f"{field_name} is invalid", retryable=False)
    return value.strip()


def _required_positive_integer_string(value: Any, field_name: str) -> str:
    text = _required_text(value, field_name)
    if not text.isdigit() or int(text) <= 0:
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", f"{field_name} is invalid", retryable=False)
    return text


def _required_int(value: Any, field_name: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", f"{field_name} is invalid", retryable=False)
    return value


def _required_object(value: Any, field_name: str) -> dict[str, object]:
    if not _is_object(value):
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", f"{field_name} is invalid", retryable=False)
    return dict(value)


def _normalize_content_type(value: str) -> str:
    return value.split(";", 1)[0].strip().lower()


@dataclass(frozen=True)
class RuntimeGrant:
    method: str
    object_key: str
    url: str
    expires_at: str
    headers: dict[str, str]


@dataclass(frozen=True)
class QualityCheckClaim:
    job_id: str
    session_id: str
    attempt_no: int
    lease_token: str
    input_manifest: dict[str, object]
    source_read: RuntimeGrant
    result_manifest_write: RuntimeGrant


class FfprobeAdapterFactory(Protocol):
    def __call__(self, workspace_root: Path) -> FfprobeAdapter: ...


class _HeartbeatKeeper:
    def __init__(
        self,
        *,
        report_progress: Callable[[dict[str, object]], None] | None,
        interval_seconds: float,
    ) -> None:
        self._report_progress = report_progress
        self._interval_seconds = interval_seconds
        self._latest_progress: dict[str, object] | None = None
        self._lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._failure: Exception | None = None

    def start(self) -> None:
        if self._report_progress is None:
            return
        self._thread = threading.Thread(
            target=self._run,
            name="educlaw-quality-heartbeat",
        )
        self._thread.start()

    def update(
        self,
        progress: dict[str, object],
        *,
        immediate: bool = True,
    ) -> None:
        if self._report_progress is None:
            return
        self.raise_if_failed()
        snapshot = dict(progress)
        with self._lock:
            self._latest_progress = snapshot
        if immediate:
            self._send(snapshot)
            self.raise_if_failed()

    def raise_if_failed(self) -> None:
        if self._failure is not None:
            raise self._failure

    def stop(self) -> None:
        if self._thread is None:
            return
        self._stop_event.set()
        self._thread.join(timeout=max(1.0, self._interval_seconds * 2))

    def _run(self) -> None:
        while not self._stop_event.wait(self._interval_seconds):
            if self._failure is not None:
                return
            with self._lock:
                latest = None if self._latest_progress is None else dict(self._latest_progress)
            if latest is not None:
                self._send(latest)

    def _send(self, progress: dict[str, object]) -> None:
        if self._report_progress is None or self._failure is not None:
            return
        try:
            with self._send_lock:
                self._report_progress(dict(progress))
        except Exception as error:  # pragma: no cover - exercised via raise_if_failed
            self._failure = error
            self._stop_event.set()


def parse_quality_check_claim(job: Mapping[str, object]) -> QualityCheckClaim:
    if not _is_object(job):
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", "claimed job is invalid", retryable=False)
    if _required_text(job.get("jobType"), "jobType") != "media_quality_check":
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", "jobType is invalid", retryable=False)
    runtime_grants = _required_object(job.get("runtimeGrants"), "runtimeGrants")
    source_read = _parse_runtime_grant(runtime_grants.get("sourceRead"), expected_method="GET")
    result_manifest_write = _parse_runtime_grant(
        runtime_grants.get("resultManifestWrite"),
        expected_method="PUT",
    )
    input_manifest = _required_object(job.get("inputManifest"), "inputManifest")
    return QualityCheckClaim(
        job_id=_required_positive_integer_string(job.get("jobId"), "jobId"),
        session_id=_required_positive_integer_string(job.get("sessionId"), "sessionId"),
        attempt_no=_required_int(job.get("attemptNo"), "attemptNo", 1),
        lease_token=_required_text(job.get("leaseToken"), "leaseToken"),
        input_manifest=input_manifest,
        source_read=source_read,
        result_manifest_write=result_manifest_write,
    )


def _parse_runtime_grant(value: Any, *, expected_method: str) -> RuntimeGrant:
    record = _required_object(value, "runtimeGrant")
    method = _required_text(record.get("method"), "runtimeGrant.method")
    if method != expected_method:
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", "runtime grant method is invalid", retryable=False)
    headers_value = record.get("headers", {})
    if not _is_object(headers_value):
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", "runtime grant headers are invalid", retryable=False)
    headers = {
        _required_text(key, "runtimeGrant.headers.key").lower(): _required_text(
            header_value,
            "runtimeGrant.headers.value",
        )
        for key, header_value in headers_value.items()
    }
    return RuntimeGrant(
        method=method,
        object_key=_required_text(record.get("objectKey"), "runtimeGrant.objectKey"),
        url=_required_text(record.get("url"), "runtimeGrant.url"),
        expires_at=_required_text(record.get("expiresAt"), "runtimeGrant.expiresAt"),
        headers=headers,
    )


class QualityCheckExecutor:
    def __init__(
        self,
        *,
        ffprobe_adapter_factory: FfprobeAdapterFactory | None = None,
        processor_version: str = PROCESSOR_VERSION,
        max_duration_ms: int = 12 * 60 * 60 * 1000,
        heartbeat_interval_seconds: float = 15.0,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._max_duration_ms = max_duration_ms
        self._heartbeat_interval_seconds = heartbeat_interval_seconds
        self._ffprobe_adapter_factory = (
            ffprobe_adapter_factory
            if ffprobe_adapter_factory is not None
            else lambda workspace_root: FfprobeAdapter(
                workspace_root=workspace_root,
                max_duration_ms=self._max_duration_ms,
            )
        )
        self._processor_version = processor_version
        self._now = now or (lambda: datetime.now(timezone.utc))

    def run(
        self,
        job: Mapping[str, object],
        *,
        report_progress: Callable[[dict[str, object]], None] | None = None,
        refresh_runtime_grants: Callable[[], dict[str, object]] | None = None,
    ) -> FakeExecutorResult:
        claim = parse_quality_check_claim(job)
        manifest = _parse_input_manifest(claim.input_manifest)
        if claim.source_read.object_key != manifest["objectKey"]:
            raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", "sourceRead grant is invalid", retryable=False)

        with tempfile.TemporaryDirectory(prefix="educlaw-quality-check-") as tmp_dir:
            workspace_root = Path(tmp_dir)
            downloaded_file = workspace_root / _download_file_name(manifest["fileName"])
            heartbeat_keeper = _HeartbeatKeeper(
                report_progress=report_progress,
                interval_seconds=self._heartbeat_interval_seconds,
            )
            heartbeat_keeper.start()
            try:
                heartbeat_keeper.update({"phase": "downloading_source", "percent": 15})
                observed_size, observed_content_type, source_hash = self._download_source(
                    claim.source_read,
                    downloaded_file,
                    expected_size=int(manifest["expectedSizeBytes"]),
                    heartbeat_keeper=heartbeat_keeper,
                )
                heartbeat_keeper.raise_if_failed()
                if observed_size != manifest["expectedSizeBytes"]:
                    raise _stable_error("FILE_MISMATCH", "Downloaded object size did not match", retryable=False)
                if observed_content_type != _normalize_content_type(manifest["expectedContentType"]):
                    raise _stable_error("FILE_MISMATCH", "Downloaded object content type did not match", retryable=False)

                heartbeat_keeper.update({"phase": "probing_media", "percent": 55})
                probe_result = self._probe_media(workspace_root, downloaded_file, manifest["mediaKind"])
                heartbeat_keeper.raise_if_failed()
                trusted_content_type = _derive_trusted_content_type(
                    probe_result,
                    str(manifest["mediaKind"]),
                )
                if trusted_content_type != _normalize_content_type(
                    str(manifest["expectedContentType"])
                ):
                    raise _stable_error(
                        "FILE_MISMATCH",
                        "Downloaded object content type did not match probed media",
                        retryable=False,
                    )
                degradations = _probe_degradations(probe_result)

                full_manifest = _build_full_manifest(
                    manifest=manifest,
                    session_id=claim.session_id,
                    observed_size=observed_size,
                    observed_content_type=trusted_content_type,
                    source_hash=source_hash,
                    probe_result=probe_result,
                    processor_version=self._processor_version,
                    degradations=degradations,
                    generated_at=self._now().astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                )
                manifest_bytes = canonical_json(full_manifest).encode("utf-8")

                heartbeat_keeper.update({"phase": "uploading_result_manifest", "percent": 85})
                result_manifest_write = claim.result_manifest_write
                if refresh_runtime_grants is not None:
                    refreshed = _required_object(
                        refresh_runtime_grants(), "runtimeGrants"
                    )
                    result_manifest_write = _parse_runtime_grant(
                        refreshed.get("resultManifestWrite"),
                        expected_method="PUT",
                    )
                    if (
                        result_manifest_write.object_key
                        != claim.result_manifest_write.object_key
                    ):
                        raise _stable_error(
                            "MEDIA_QUALITY_CHECK_INVALID_JOB",
                            "resultManifestWrite grant binding changed during refresh",
                            retryable=False,
                        )
                self._upload_manifest(result_manifest_write, manifest_bytes)
                heartbeat_keeper.raise_if_failed()
                manifest_hash = sha256(manifest_bytes).hexdigest()

                output_manifest = {
                    "schemaVersion": 1,
                    "jobType": "media_quality_check",
                    "sessionId": claim.session_id,
                    "sourceId": manifest["sourceId"],
                    "sourceKind": manifest["mediaKind"],
                    "sourceAsset": {
                        "objectKey": manifest["objectKey"],
                        "mimeType": trusted_content_type,
                        "sizeBytes": observed_size,
                        "sha256": source_hash,
                    },
                    "probe": {
                        "durationMs": probe_result.duration_ms,
                        "formatName": probe_result.format_name,
                        "hasAudio": probe_result.has_audio,
                        "hasVideo": probe_result.has_video,
                        "audioStreamCount": sum(
                            1 for stream in probe_result.streams if stream.get("codecType") == "audio"
                        ),
                        "videoStreamCount": sum(
                            1 for stream in probe_result.streams if stream.get("codecType") == "video"
                        ),
                        "primaryAudioStreamIndex": probe_result.primary_audio_stream_index,
                        "primaryVideoStreamIndex": probe_result.primary_video_stream_index,
                    },
                    "resultManifestRef": {
                        "objectKey": result_manifest_write.object_key,
                        "mimeType": "application/json",
                        "sizeBytes": len(manifest_bytes),
                        "sha256": manifest_hash,
                    },
                    "processorVersion": self._processor_version,
                    "degradations": degradations,
                }
                result_hash = sha256(canonical_json(output_manifest).encode("utf-8")).hexdigest()
                return FakeExecutorResult(result_hash=result_hash, output_manifest=output_manifest)
            finally:
                heartbeat_keeper.stop()

    def _download_source(
        self,
        grant: RuntimeGrant,
        destination: Path,
        *,
        expected_size: int,
        heartbeat_keeper: _HeartbeatKeeper | None = None,
    ) -> tuple[int, str, str]:
        hasher = sha256()
        observed_size = 0
        last_heartbeat_at = self._now()
        try:
            with httpx.Client(timeout=30.0) as client:
                with client.stream(
                    "GET",
                    grant.url,
                    headers=grant.headers,
                ) as response:
                    if response.status_code == 404:
                        raise _stable_error("UPLOAD_NOT_FOUND", "Uploaded object was not found", retryable=False)
                    if response.status_code >= 500 or response.status_code in {401, 403, 408, 409, 429}:
                        raise _stable_error(
                            "MULTIMODAL_UPLOAD_UNAVAILABLE",
                            "Source download failed",
                            retryable=True,
                        )
                    if response.status_code < 200 or response.status_code >= 300:
                        raise _stable_error(
                            "MULTIMODAL_UPLOAD_UNAVAILABLE",
                            "Source download failed",
                            retryable=False,
                        )
                    observed_content_type = _normalize_content_type(
                        response.headers.get("content-type", "")
                    )
                    with destination.open("wb") as output_file:
                        for chunk in response.iter_bytes():
                            if not chunk:
                                continue
                            output_file.write(chunk)
                            hasher.update(chunk)
                            observed_size += len(chunk)
                            if heartbeat_keeper is not None:
                                heartbeat_keeper.raise_if_failed()
                            if observed_size > expected_size:
                                raise _stable_error(
                                    "FILE_MISMATCH",
                                    "Downloaded object size did not match",
                                    retryable=False,
                                )
                            if heartbeat_keeper is not None:
                                current_time = self._now()
                                if (
                                    current_time - last_heartbeat_at
                                ).total_seconds() >= self._heartbeat_interval_seconds:
                                    percent = 15 + min(
                                        35,
                                        int((observed_size / expected_size) * 35),
                                    )
                                    heartbeat_keeper.update(
                                        {
                                            "phase": "downloading_source",
                                            "percent": percent,
                                        }
                                    )
                                    last_heartbeat_at = current_time
        except QualityCheckExecutionError:
            raise
        except httpx.HTTPError:
            raise _stable_error(
                "MULTIMODAL_UPLOAD_UNAVAILABLE",
                "Source download failed",
                retryable=True,
            )
        return observed_size, observed_content_type, hasher.hexdigest()

    def _probe_media(
        self,
        workspace_root: Path,
        input_path: Path,
        media_kind: str,
    ) -> MediaProbeResult:
        try:
            adapter = self._ffprobe_adapter_factory(workspace_root)
            return adapter.probe_media(
                input_path,
                source_kind="audio" if media_kind == "audio" else "video",
            )
        except MediaAdapterError as error:
            if error.code == "MEDIA_PROBE_TIMEOUT":
                raise _stable_error("MEDIA_PROBE_TIMEOUT", "Media probe timed out", retryable=True)
            if error.code == "MEDIA_PROBE_UNSUPPORTED":
                raise _stable_error("MEDIA_PROBE_UNSUPPORTED", "Media probe reported unsupported media", retryable=False)
            raise _stable_error("MEDIA_PROBE_FAILED", "Media probe failed", retryable=False)

    def _upload_manifest(self, grant: RuntimeGrant, manifest_bytes: bytes) -> None:
        headers = dict(grant.headers)
        if "content-type" not in headers:
          headers["content-type"] = "application/json"
        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.put(
                    grant.url,
                    headers=headers,
                    content=manifest_bytes,
                )
        except httpx.HTTPError:
            raise _stable_error(
                "QUALITY_RESULT_MANIFEST_UPLOAD_FAILED",
                "Result manifest upload failed",
                retryable=True,
            )
        if response.status_code >= 500 or response.status_code in {401, 403, 408, 409, 429}:
            raise _stable_error(
                "QUALITY_RESULT_MANIFEST_UPLOAD_FAILED",
                "Result manifest upload failed",
                retryable=True,
            )
        if response.status_code < 200 or response.status_code >= 300:
            raise _stable_error(
                "QUALITY_RESULT_MANIFEST_UPLOAD_FAILED",
                "Result manifest upload failed",
                retryable=False,
            )


def _parse_input_manifest(value: Mapping[str, object]) -> dict[str, object]:
    required_keys = {
        "schemaVersion",
        "sourceId",
        "mediaKind",
        "objectKey",
        "fileName",
        "expectedSizeBytes",
        "expectedContentType",
        "uploadMode",
    }
    if set(value.keys()) != required_keys:
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", "inputManifest is invalid", retryable=False)
    schema_version = _required_int(value.get("schemaVersion"), "schemaVersion", 1)
    if schema_version != 1:
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", "schemaVersion is invalid", retryable=False)
    media_kind = _required_text(value.get("mediaKind"), "mediaKind")
    if media_kind not in {"audio", "video"}:
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", "mediaKind is invalid", retryable=False)
    upload_mode = _required_text(value.get("uploadMode"), "uploadMode")
    if upload_mode not in {"single_put", "multipart"}:
        raise _stable_error("MEDIA_QUALITY_CHECK_INVALID_JOB", "uploadMode is invalid", retryable=False)
    return {
        "schemaVersion": 1,
        "sourceId": _required_text(value.get("sourceId"), "sourceId"),
        "mediaKind": media_kind,
        "objectKey": _required_text(value.get("objectKey"), "objectKey"),
        "fileName": _required_text(value.get("fileName"), "fileName"),
        "expectedSizeBytes": _required_int(value.get("expectedSizeBytes"), "expectedSizeBytes", 1),
        "expectedContentType": _normalize_content_type(
            _required_text(value.get("expectedContentType"), "expectedContentType")
        ),
        "uploadMode": upload_mode,
    }


def _download_file_name(file_name: str) -> str:
    suffix = Path(file_name).suffix or ".bin"
    return f"source{suffix}"


def _probe_degradations(probe_result: MediaProbeResult) -> list[dict[str, str]]:
    if probe_result.degradation is None:
        return []
    return [
        {
            "code": str(probe_result.degradation.get("mode", "UNKNOWN")).upper(),
            "message": str(probe_result.degradation.get("reason", "unknown")),
        }
    ]


def _derive_trusted_content_type(
    probe_result: MediaProbeResult,
    media_kind: str,
) -> str:
    normalized_tokens = {
        token.strip().lower()
        for token in probe_result.format_name.split(",")
        if token.strip()
    }
    if media_kind == "audio":
        if "wav" in normalized_tokens:
            return "audio/wav"
        if "mp3" in normalized_tokens:
            return "audio/mpeg"
        if "ogg" in normalized_tokens:
            return "audio/ogg"
        if {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"} & normalized_tokens:
            return "audio/mp4"
        if {"matroska", "webm"} & normalized_tokens:
            return "audio/webm"
    if media_kind == "video":
        if {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"} & normalized_tokens:
            return "video/mp4"
        if {"matroska", "webm"} & normalized_tokens:
            return "video/webm"
        if {"mpegts", "ts"} & normalized_tokens:
            return "video/mp2t"
        if "avi" in normalized_tokens:
            return "video/x-msvideo"
    raise _stable_error(
        "FILE_MISMATCH",
        "Downloaded object content type did not match probed media",
        retryable=False,
    )


def _build_full_manifest(
    *,
    manifest: dict[str, object],
    session_id: str,
    observed_size: int,
    observed_content_type: str,
    source_hash: str,
    probe_result: MediaProbeResult,
    processor_version: str,
    degradations: list[dict[str, str]],
    generated_at: str,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "jobType": "media_quality_check_manifest",
        "sessionId": session_id,
        "sourceId": manifest["sourceId"],
        "sourceKind": manifest["mediaKind"],
        "sourceAsset": {
            "objectKey": manifest["objectKey"],
            "mimeType": observed_content_type,
            "sizeBytes": observed_size,
            "sha256": source_hash,
        },
        "probe": {
            **probe_result.to_manifest(),
            "streams": probe_result.streams,
        },
        "processorVersion": processor_version,
        "generatedAt": generated_at,
        "degradations": degradations,
    }
