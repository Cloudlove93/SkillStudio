from __future__ import annotations

import tempfile
import json
import wave
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Callable, Mapping
from uuid import uuid4

import httpx

from .asr_adapter import (
    AsrAdapterConfig,
    AsrBackendConfig,
    FasterWhisperBackend,
    SegmentLevelAsrAdapter,
)
from .errors import DistillationExecutionError, MediaAdapterError
from .fake_executor import FakeExecutorResult, canonical_json
from .ffmpeg_adapter import FfmpegAdapter
from .ffprobe_adapter import FfprobeAdapter
from .frame_materializer import (
    FrameMaterializer,
    FrameMaterializerConfig,
    FrameRequest,
)
from .frame_quality import FrameQualityAssessor, QualityConfig
from .quality_check_executor import RuntimeGrant, _HeartbeatKeeper
from .visual_signal_detector import VisualSignalDetector, VisualSignalDetectorConfig


PROCESSOR_VERSION = "0.1.0"
DISTILLATION_JOB_TYPES = {"media_prepare", "transcribe", "frame_materialize"}
RefreshRuntimeGrants = Callable[[], dict[str, object]]


def _error(code: str, message: str, *, retryable: bool = False) -> DistillationExecutionError:
    error = DistillationExecutionError(code, message, retryable=retryable)
    error.__cause__ = None
    error.__context__ = None
    error.__suppress_context__ = True
    return error


def _record(value: object, field: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise _error("MEDIA_DISTILLATION_INVALID_JOB", f"{field} is invalid")
    return dict(value)


def _text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _error("MEDIA_DISTILLATION_INVALID_JOB", f"{field} is invalid")
    return value


def _positive_id(value: object, field: str) -> str:
    result = _text(value, field)
    if not result.isdigit() or int(result) <= 0:
        raise _error("MEDIA_DISTILLATION_INVALID_JOB", f"{field} is invalid")
    return result


def _integer(value: object, field: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise _error("MEDIA_DISTILLATION_INVALID_JOB", f"{field} is invalid")
    return value


def _grant(value: object, *, method: str) -> RuntimeGrant:
    item = _record(value, "runtimeGrant")
    headers = _record(item.get("headers", {}), "runtimeGrant.headers")
    normalized_headers: dict[str, str] = {}
    for key, header_value in headers.items():
        normalized_headers[_text(key, "runtimeGrant.headerKey").lower()] = _text(
            header_value, "runtimeGrant.headerValue"
        )
    actual_method = _text(item.get("method"), "runtimeGrant.method")
    if actual_method != method:
        raise _error("MEDIA_DISTILLATION_INVALID_JOB", "runtime grant method is invalid")
    return RuntimeGrant(
        method=actual_method,
        object_key=_text(item.get("objectKey"), "runtimeGrant.objectKey"),
        url=_text(item.get("url"), "runtimeGrant.url"),
        expires_at=_text(item.get("expiresAt"), "runtimeGrant.expiresAt"),
        headers=normalized_headers,
    )


def _asset(value: object, field: str) -> dict[str, object]:
    item = _record(value, field)
    object_key = _text(item.get("objectKey"), f"{field}.objectKey")
    mime_type = _text(item.get("mimeType"), f"{field}.mimeType")
    size_bytes = _integer(item.get("sizeBytes"), f"{field}.sizeBytes", minimum=1)
    digest = _text(item.get("sha256"), f"{field}.sha256")
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise _error("MEDIA_DISTILLATION_INVALID_JOB", f"{field}.sha256 is invalid")
    return {
        "objectKey": object_key,
        "mimeType": mime_type,
        "sizeBytes": size_bytes,
        "sha256": digest,
    }


def _asset_ref(grant: RuntimeGrant, content: bytes, mime_type: str) -> dict[str, object]:
    return {
        "objectKey": grant.object_key,
        "mimeType": mime_type,
        "sizeBytes": len(content),
        "sha256": sha256(content).hexdigest(),
    }


def _asset_ref_from_file(
    grant: RuntimeGrant, path: Path, mime_type: str
) -> dict[str, object]:
    digest = sha256()
    size_bytes = 0
    with path.open("rb") as source:
        while chunk := source.read(64 * 1024):
            size_bytes += len(chunk)
            digest.update(chunk)
    if size_bytes < 1:
        raise _error("MEDIA_DISTILLATION_FAILED", "Artifact is empty")
    return {
        "objectKey": grant.object_key,
        "mimeType": mime_type,
        "sizeBytes": size_bytes,
        "sha256": digest.hexdigest(),
    }


def _require_same_object_key(
    refreshed: RuntimeGrant,
    original: RuntimeGrant,
    field: str,
) -> RuntimeGrant:
    if refreshed.object_key != original.object_key:
        raise _error(
            "MEDIA_DISTILLATION_INVALID_JOB",
            f"{field} grant binding changed during refresh",
        )
    return refreshed


class DistillationExecutor:
    def __init__(
        self,
        *,
        max_duration_ms: int = 12 * 60 * 60 * 1000,
        heartbeat_interval_seconds: float = 15.0,
        processor_version: str = PROCESSOR_VERSION,
        asr_backend: object | None = None,
        asr_backend_config: AsrBackendConfig | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._max_duration_ms = max_duration_ms
        self._heartbeat_interval_seconds = heartbeat_interval_seconds
        self._processor_version = processor_version
        self._asr_backend = asr_backend or FasterWhisperBackend()
        self._asr_backend_config = asr_backend_config or AsrBackendConfig(
            model_name_or_path="large-v3",
            manifest_model_id="faster-whisper-large-v3",
            device="auto",
            compute_type="default",
            language=None,
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        self._now = now or (lambda: datetime.now(timezone.utc))

    def run(
        self,
        job: Mapping[str, object],
        *,
        report_progress: Callable[[dict[str, object]], None] | None = None,
        refresh_runtime_grants: RefreshRuntimeGrants | None = None,
    ) -> FakeExecutorResult:
        job_type = _text(job.get("jobType"), "jobType")
        if job_type not in DISTILLATION_JOB_TYPES:
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "jobType is invalid")
        keeper = _HeartbeatKeeper(
            report_progress=report_progress,
            interval_seconds=self._heartbeat_interval_seconds,
        )
        keeper.start()
        try:
            if job_type == "media_prepare":
                return self._run_prepare(job, keeper, refresh_runtime_grants)
            if job_type == "transcribe":
                return self._run_transcribe(job, keeper, refresh_runtime_grants)
            return self._run_frames(job, keeper, refresh_runtime_grants)
        except DistillationExecutionError:
            raise
        except MediaAdapterError as error:
            raise _error(error.code, "Media processing failed", retryable=error.retryable)
        except httpx.HTTPError:
            raise _error("OBJECT_STORAGE_UNAVAILABLE", "Object storage request failed", retryable=True)
        finally:
            keeper.stop()

    def _identity(self, job: Mapping[str, object]) -> tuple[str, str, int, dict[str, object], dict[str, object]]:
        session_id = _positive_id(job.get("sessionId"), "sessionId")
        job_id = _positive_id(job.get("jobId"), "jobId")
        attempt_no = _integer(job.get("attemptNo"), "attemptNo", minimum=1)
        input_manifest = _record(job.get("inputManifest"), "inputManifest")
        grants = _record(job.get("runtimeGrants"), "runtimeGrants")
        return session_id, job_id, attempt_no, input_manifest, grants

    def _fresh_grants(
        self,
        original_grants: dict[str, object],
        refresh_runtime_grants: RefreshRuntimeGrants | None,
    ) -> dict[str, object]:
        if refresh_runtime_grants is None:
            return original_grants
        return _record(refresh_runtime_grants(), "runtimeGrants")

    def _run_prepare(
        self,
        job: Mapping[str, object],
        keeper: _HeartbeatKeeper,
        refresh_runtime_grants: RefreshRuntimeGrants | None,
    ) -> FakeExecutorResult:
        session_id, _, _, manifest, grants = self._identity(job)
        source_id = _text(manifest.get("sourceId"), "sourceId")
        source_kind = _text(manifest.get("sourceKind"), "sourceKind")
        if source_kind not in {"audio", "video"}:
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "sourceKind is invalid")
        source_asset = _asset(manifest.get("sourceAsset"), "sourceAsset")
        source_read = _grant(grants.get("sourceRead"), method="GET")
        result_write = _grant(grants.get("resultManifestWrite"), method="PUT")
        artifact_writes = _record(grants.get("artifactWrites"), "artifactWrites")
        if source_read.object_key != source_asset["objectKey"]:
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "source grant binding is invalid")

        with tempfile.TemporaryDirectory(prefix="educlaw-media-prepare-") as temporary:
            workspace = Path(temporary)
            source_path = workspace / ("source.mp4" if source_kind == "video" else "source.audio")
            keeper.update({"phase": "downloading_source", "percent": 10})
            self._download(source_read, source_path, int(source_asset["sizeBytes"]), str(source_asset["sha256"]))
            probe_adapter = FfprobeAdapter(
                workspace_root=workspace,
                max_duration_ms=self._max_duration_ms,
            )
            keeper.update({"phase": "probing_media", "percent": 30})
            probe = probe_adapter.probe_media(source_path, source_kind=source_kind)
            if probe.duration_ms > self._max_duration_ms:
                raise _error("MEDIA_DURATION_EXCEEDED", "Media duration exceeds configured limit")

            normalized_audio_ref = None
            if probe.has_audio:
                audio_write = _grant(artifact_writes.get("normalizedAudio"), method="PUT")
                ffmpeg = FfmpegAdapter(
                    workspace_root=workspace,
                    probe_adapter=probe_adapter,
                    max_output_bytes=max(32 * 1024 * 1024, int(probe.duration_ms / 1000) * 40_000),
                    timeout_seconds=max(30.0, min(600.0, probe.duration_ms / 1000 * 0.25)),
                )
                keeper.update({"phase": "normalizing_audio", "percent": 50})
                normalized = ffmpeg.normalize_audio(source_path)
                fresh_grants = self._fresh_grants(grants, refresh_runtime_grants)
                fresh_artifact_writes = _record(
                    fresh_grants.get("artifactWrites"), "artifactWrites"
                )
                audio_write = _require_same_object_key(
                    _grant(fresh_artifact_writes.get("normalizedAudio"), method="PUT"),
                    audio_write,
                    "normalizedAudio",
                )
                normalized_audio_ref = _asset_ref_from_file(
                    audio_write, normalized.local_path, "audio/wav"
                )
                self._upload_file(audio_write, normalized.local_path, "audio/wav")
            elif "normalizedAudio" in artifact_writes:
                raise _error("MEDIA_DISTILLATION_INVALID_JOB", "unexpected audio grant")

            visual_signals = None
            degradations: list[dict[str, str]] = []
            if source_kind == "video":
                keeper.update({"phase": "detecting_visual_signals", "percent": 70})
                detector = VisualSignalDetector(
                    workspace_root=workspace,
                    config=VisualSignalDetectorConfig(
                        processor_version=self._processor_version,
                        algorithm="gray_diff_scene_and_slow_change_bounded_steps_v2",
                        sample_width=320,
                        sample_height=180,
                        min_sample_interval_ms=2_000,
                        max_samples=600,
                        max_scene_signals=128,
                        max_slow_signals=128,
                        min_signal_spacing_ms=3_000,
                        scene_change_threshold=0.32,
                        slow_change_max_step_threshold=0.04,
                        slow_change_accum_threshold=0.12,
                        slow_change_min_run_samples=3,
                        timeout_seconds=600.0,
                        max_stdout_bytes_margin=64 * 1024,
                        max_stderr_bytes=4 * 1024 * 1024,
                    ),
                )
                detected = detector.detect_signals(source_path, probe)
                visual_signals = {
                    "sceneChangeTimestampsMs": detected.scene_change_timestamps_ms,
                    "slowVisualChangeTimestampsMs": detected.slow_visual_change_timestamps_ms,
                    "sampledFrameCount": detected.sampled_frame_count,
                    "detectorVersion": self._processor_version,
                }
                degradations.extend(
                    {"code": item["mode"], "message": item["reason"]}
                    for item in detected.degradations
                )

            detail = {
                "schemaVersion": 1,
                "generatedAt": self._now().astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "sourceAsset": source_asset,
                "durationMs": probe.duration_ms,
                "hasAudio": probe.has_audio,
                "hasVideo": probe.has_video,
                "visualSignals": visual_signals,
            }
            detail_bytes = canonical_json(detail).encode("utf-8")
            keeper.update({"phase": "uploading_result_manifest", "percent": 88})
            fresh_grants = self._fresh_grants(grants, refresh_runtime_grants)
            result_write = _require_same_object_key(
                _grant(fresh_grants.get("resultManifestWrite"), method="PUT"),
                result_write,
                "resultManifestWrite",
            )
            self._upload_bytes(result_write, detail_bytes, "application/json")
            output = {
                "schemaVersion": 1,
                "jobType": "media_prepare",
                "sessionId": session_id,
                "sourceId": source_id,
                "sourceKind": source_kind,
                "durationMs": probe.duration_ms,
                "hasAudio": probe.has_audio,
                "hasVideo": probe.has_video,
                "normalizedAudioAssetRef": normalized_audio_ref,
                "visualSignals": visual_signals,
                "resultManifestRef": _asset_ref(result_write, detail_bytes, "application/json"),
                "processorVersion": self._processor_version,
                "degradations": degradations,
            }
            return self._result(output)

    def _run_transcribe(
        self,
        job: Mapping[str, object],
        keeper: _HeartbeatKeeper,
        refresh_runtime_grants: RefreshRuntimeGrants | None,
    ) -> FakeExecutorResult:
        session_id, job_id, attempt_no, manifest, grants = self._identity(job)
        source_id = _text(manifest.get("sourceId"), "sourceId")
        duration_ms = _integer(manifest.get("durationMs"), "durationMs", minimum=1)
        audio_asset = _asset(manifest.get("audioAssetRef"), "audioAssetRef")
        chunk_plan = self._chunk_plan(manifest.get("chunkPlan"), duration_ms)
        source_read = _grant(grants.get("sourceRead"), method="GET")
        artifact_writes = _record(grants.get("artifactWrites"), "artifactWrites")
        transcript_write = _grant(artifact_writes.get("transcript"), method="PUT")
        chunk_writes = self._chunk_grants(
            artifact_writes.get("transcriptChunks"),
            chunk_plan=chunk_plan,
            session_id=session_id,
            job_id=job_id,
            attempt_no=attempt_no,
            method="PUT",
        )
        recovery_group = _record(grants.get("recoveryReads", {}), "recoveryReads")
        recovery_reads = self._recovery_chunk_grants(
            recovery_group.get("transcriptChunks", []),
            chunk_plan=chunk_plan,
            session_id=session_id,
            job_id=job_id,
            attempt_no=attempt_no,
        )
        result_write = _grant(grants.get("resultManifestWrite"), method="PUT")
        if source_read.object_key != audio_asset["objectKey"]:
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "audio grant binding is invalid")

        with tempfile.TemporaryDirectory(prefix="educlaw-transcribe-") as temporary:
            workspace = Path(temporary)
            audio_path = workspace / "normalized-audio.wav"
            keeper.update({"phase": "downloading_audio", "percent": 15})
            self._download(source_read, audio_path, int(audio_asset["sizeBytes"]), str(audio_asset["sha256"]))
            adapter = SegmentLevelAsrAdapter(
                workspace_root=workspace,
                backend=self._asr_backend,
                config=AsrAdapterConfig(
                    backend_config=self._asr_backend_config,
                    low_confidence_threshold=0.65,
                    max_segments=10_000,
                    max_segment_characters=4_096,
                    max_total_characters=2_000_000,
                    fail_on_low_confidence=False,
                    language_probability_threshold=0.6,
                    processor_version=self._processor_version,
                ),
            )
            transcript_segments: list[dict[str, object]] = []
            degradations: list[dict[str, str]] = []
            chunk_manifest_refs: list[dict[str, object]] = []
            for chunk in chunk_plan:
                keeper.update(
                    {
                        "phase": "transcribing_audio",
                        "percent": 20
                        + int(55 * (int(chunk["chunkIndex"]) / len(chunk_plan))),
                        "chunkIndex": chunk["chunkIndex"],
                        "chunkCount": len(chunk_plan),
                    }
                )
                recovered = None
                for recovery_grant in recovery_reads[int(chunk["chunkIndex"])]:
                    recovered = self._try_recover_chunk(
                        recovery_grant,
                        session_id=session_id,
                        source_id=source_id,
                        audio_sha256=str(audio_asset["sha256"]),
                        chunk=chunk,
                    )
                    if recovered is not None:
                        break
                if recovered is None:
                    chunk_path = audio_path
                    if len(chunk_plan) > 1:
                        chunk_path = workspace / f"chunk-{int(chunk['chunkIndex']):04d}.wav"
                        self._materialize_wav_chunk(
                            audio_path,
                            chunk_path,
                            start_ms=int(chunk["startMs"]),
                            end_ms=int(chunk["endMs"]),
                        )
                    chunk_duration_ms = int(chunk["endMs"]) - int(chunk["startMs"])
                    try:
                        asr = adapter.transcribe_audio(
                            chunk_path,
                            duration_ms=chunk_duration_ms,
                        )
                    except MediaAdapterError as error:
                        if error.code != "ASR_EMPTY":
                            raise
                        chunk_segments: list[dict[str, object]] = []
                        chunk_degradations = [
                            {
                                "code": "ASR_CHUNK_EMPTY",
                                "message": "No speech was detected in this audio chunk",
                            }
                        ]
                    else:
                        chunk_segments = [
                            {
                                "startMs": int(segment["startMs"])
                                + int(chunk["startMs"]),
                                "endMs": int(segment["endMs"])
                                + int(chunk["startMs"]),
                                "text": segment["text"],
                                "speaker": segment.get("speaker"),
                                "confidence": segment.get("confidence"),
                            }
                            for segment in asr.segments
                        ]
                        chunk_degradations = [
                            {
                                "code": str(item["mode"]).upper(),
                                "message": str(item["reason"]),
                            }
                            for item in asr.degradations
                        ]
                    recovered = {
                        "schemaVersion": 1,
                        "jobType": "transcribe_chunk",
                        "sessionId": session_id,
                        "sourceId": source_id,
                        "audioSha256": audio_asset["sha256"],
                        "chunkIndex": chunk["chunkIndex"],
                        "startMs": chunk["startMs"],
                        "endMs": chunk["endMs"],
                        "processorVersion": self._processor_version,
                        "transcript": {
                            "status": "low_confidence" if chunk_degradations else "ready",
                            "editable": True,
                            "segments": chunk_segments,
                        },
                        "degradations": chunk_degradations,
                    }
                chunk_bytes = canonical_json(recovered).encode("utf-8")
                chunk_index = int(chunk["chunkIndex"])
                fresh_grants = self._fresh_grants(grants, refresh_runtime_grants)
                fresh_artifact_writes = _record(
                    fresh_grants.get("artifactWrites"), "artifactWrites"
                )
                fresh_chunk_writes = self._chunk_grants(
                    fresh_artifact_writes.get("transcriptChunks"),
                    chunk_plan=chunk_plan,
                    session_id=session_id,
                    job_id=job_id,
                    attempt_no=attempt_no,
                    method="PUT",
                )
                chunk_write = _require_same_object_key(
                    fresh_chunk_writes[chunk_index],
                    chunk_writes[chunk_index],
                    f"transcriptChunks[{chunk_index}]",
                )
                self._upload_bytes(chunk_write, chunk_bytes, "application/json")
                transcript_segments.extend(recovered["transcript"]["segments"])
                degradations.extend(recovered["degradations"])
                chunk_manifest_refs.append(
                    _asset_ref(chunk_write, chunk_bytes, "application/json")
                )
            if len(transcript_segments) > 10_000:
                raise _error("ASR_FAILED", "ASR transcript exceeded limits")
            low_confidence = bool(degradations)
            transcript = {
                "status": "low_confidence" if low_confidence else "ready",
                "editable": True,
                "segments": transcript_segments,
            }
            transcript_detail = {
                "schemaVersion": 1,
                "durationMs": duration_ms,
                "processorVersion": self._processor_version,
                "chunkManifestRefs": chunk_manifest_refs,
                "transcript": transcript,
                "degradations": degradations,
            }
            transcript_bytes = canonical_json(transcript_detail).encode("utf-8")
            keeper.update({"phase": "uploading_transcript", "percent": 80})
            fresh_grants = self._fresh_grants(grants, refresh_runtime_grants)
            fresh_artifact_writes = _record(
                fresh_grants.get("artifactWrites"), "artifactWrites"
            )
            transcript_write = _require_same_object_key(
                _grant(fresh_artifact_writes.get("transcript"), method="PUT"),
                transcript_write,
                "transcript",
            )
            self._upload_bytes(transcript_write, transcript_bytes, "application/json")
            detail = {
                "schemaVersion": 1,
                "transcriptAsset": _asset_ref(transcript_write, transcript_bytes, "application/json"),
                "chunkManifestRefs": chunk_manifest_refs,
            }
            detail_bytes = canonical_json(detail).encode("utf-8")
            fresh_grants = self._fresh_grants(grants, refresh_runtime_grants)
            result_write = _require_same_object_key(
                _grant(fresh_grants.get("resultManifestWrite"), method="PUT"),
                result_write,
                "resultManifestWrite",
            )
            self._upload_bytes(result_write, detail_bytes, "application/json")
            output = {
                "schemaVersion": 1,
                "jobType": "transcribe",
                "sessionId": session_id,
                "sourceId": source_id,
                "durationMs": duration_ms,
                "transcript": transcript,
                "transcriptAssetRef": _asset_ref(transcript_write, transcript_bytes, "application/json"),
                "resultManifestRef": _asset_ref(result_write, detail_bytes, "application/json"),
                "processorVersion": self._processor_version,
                "degradations": degradations,
            }
            return self._result(output)

    def _run_frames(
        self,
        job: Mapping[str, object],
        keeper: _HeartbeatKeeper,
        refresh_runtime_grants: RefreshRuntimeGrants | None,
    ) -> FakeExecutorResult:
        session_id, _, _, manifest, grants = self._identity(job)
        source_id = _text(manifest.get("sourceId"), "sourceId")
        source_asset = _asset(manifest.get("sourceAsset"), "sourceAsset")
        requests_value = manifest.get("frameRequests")
        if not isinstance(requests_value, list) or not requests_value or len(requests_value) > 48:
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "frameRequests is invalid")
        requests = [self._frame_request(item) for item in requests_value]
        source_read = _grant(grants.get("sourceRead"), method="GET")
        writes = _record(grants.get("artifactWrites"), "artifactWrites").get("frames")
        if not isinstance(writes, list) or len(writes) != len(requests):
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "frame grants are invalid")
        write_by_id = {
            _text(_record(item, "frameGrant").get("candidateId"), "candidateId"): _grant(item, method="PUT")
            for item in writes
        }
        result_write = _grant(grants.get("resultManifestWrite"), method="PUT")
        if source_read.object_key != source_asset["objectKey"] or len(write_by_id) != len(requests):
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "frame grant binding is invalid")

        with tempfile.TemporaryDirectory(prefix="educlaw-frame-materialize-") as temporary:
            workspace = Path(temporary)
            video_path = workspace / "source.mp4"
            keeper.update({"phase": "downloading_video", "percent": 10})
            self._download(source_read, video_path, int(source_asset["sizeBytes"]), str(source_asset["sha256"]))
            probe = FfprobeAdapter(workspace_root=workspace, max_duration_ms=self._max_duration_ms)
            materializer = FrameMaterializer(
                workspace_root=workspace,
                probe_adapter=probe,
                config=FrameMaterializerConfig(
                    processor_version=self._processor_version,
                    max_candidates=48,
                    max_width=960,
                    max_output_bytes=8 * 1024 * 1024,
                    max_image_pixels=8_000_000,
                    timeout_seconds=60.0,
                    max_stdout_bytes=64 * 1024,
                    max_stderr_bytes=256 * 1024,
                    create_output_token=lambda: str(uuid4()),
                ),
            )
            keeper.update({"phase": "materializing_frames", "percent": 45})
            frames = materializer.materialize_frames(video_path, requests=requests)
            assessor = FrameQualityAssessor(
                workspace_root=workspace,
                config=QualityConfig(
                    processor_version=self._processor_version,
                    min_sharpness=0.05,
                    black_pixel_luma=10,
                    white_pixel_luma=245,
                    max_black_pixel_ratio=0.92,
                    max_white_pixel_ratio=0.92,
                    min_entropy=0.10,
                    duplicate_hash_distance_max=2,
                    max_image_pixels=8_000_000,
                    max_image_bytes=8 * 1024 * 1024,
                    max_frames=48,
                    analysis_max_dimension=512,
                ),
            )
            quality = assessor.assess_frames(frames)
            fresh_grants = self._fresh_grants(grants, refresh_runtime_grants)
            fresh_writes = _record(
                fresh_grants.get("artifactWrites"), "artifactWrites"
            ).get("frames")
            if not isinstance(fresh_writes, list) or len(fresh_writes) != len(requests):
                raise _error("MEDIA_DISTILLATION_INVALID_JOB", "frame grants are invalid")
            fresh_write_by_id = {
                _text(_record(item, "frameGrant").get("candidateId"), "candidateId"): _grant(
                    item, method="PUT"
                )
                for item in fresh_writes
            }
            if set(fresh_write_by_id) != set(write_by_id):
                raise _error(
                    "MEDIA_DISTILLATION_INVALID_JOB", "frame grant binding is invalid"
                )
            for candidate_id, original_grant in write_by_id.items():
                _require_same_object_key(
                    fresh_write_by_id[candidate_id],
                    original_grant,
                    f"frames[{candidate_id}]",
                )
            frame_by_id = {frame.candidate_id: frame for frame in frames}
            candidates: list[dict[str, object]] = []
            keeper.update({"phase": "uploading_frames", "percent": 75})
            for result in quality:
                frame = frame_by_id[result.candidate_id]
                grant = fresh_write_by_id.get(result.candidate_id)
                if grant is None:
                    raise _error("MEDIA_DISTILLATION_INVALID_JOB", "frame grant binding is invalid")
                frame_asset_ref = _asset_ref_from_file(
                    grant, frame.local_path, "image/png"
                )
                self._upload_file(grant, frame.local_path, "image/png")
                candidates.append(
                    {
                        "candidateId": result.candidate_id,
                        "semanticMomentId": result.semantic_moment_id,
                        "timestampMs": result.timestamp_ms,
                        "sourceSignal": result.source_signal,
                        "selectionReason": result.selection_reason,
                        "assetRef": frame_asset_ref,
                        "metrics": result.metrics,
                        "hardRejectedReasons": result.hard_rejected_reasons,
                        "suppressed": result.suppressed,
                        "duplicateOf": result.duplicate_of,
                        "frameExtractorVersion": self._processor_version,
                        "qualityProcessorVersion": self._processor_version,
                    }
                )
            detail_bytes = canonical_json({"schemaVersion": 1, "candidates": candidates}).encode("utf-8")
            fresh_grants = self._fresh_grants(grants, refresh_runtime_grants)
            result_write = _require_same_object_key(
                _grant(fresh_grants.get("resultManifestWrite"), method="PUT"),
                result_write,
                "resultManifestWrite",
            )
            self._upload_bytes(result_write, detail_bytes, "application/json")
            output = {
                "schemaVersion": 1,
                "jobType": "frame_materialize",
                "sessionId": session_id,
                "sourceId": source_id,
                "candidates": candidates,
                "resultManifestRef": _asset_ref(result_write, detail_bytes, "application/json"),
                "processorVersion": self._processor_version,
                "degradations": [],
            }
            return self._result(output)

    def _frame_request(self, value: object) -> FrameRequest:
        item = _record(value, "frameRequest")
        return FrameRequest(
            candidate_id=_text(item.get("candidateId"), "candidateId"),
            semantic_moment_id=_text(item.get("semanticMomentId"), "semanticMomentId"),
            timestamp_ms=_integer(item.get("timestampMs"), "timestampMs"),
            source_signal=_text(item.get("sourceSignal"), "sourceSignal"),
            selection_reason=_text(item.get("selectionReason"), "selectionReason"),
        )

    def _chunk_plan(self, value: object, duration_ms: int) -> list[dict[str, int]]:
        if not isinstance(value, list) or not value or len(value) > 256:
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "chunkPlan is invalid")
        chunks: list[dict[str, int]] = []
        previous_end_ms = 0
        for expected_index, raw in enumerate(value):
            item = _record(raw, "chunkPlanItem")
            if set(item) != {"chunkIndex", "startMs", "endMs"}:
                raise _error("MEDIA_DISTILLATION_INVALID_JOB", "chunkPlan is invalid")
            chunk_index = _integer(item.get("chunkIndex"), "chunkIndex")
            start_ms = _integer(item.get("startMs"), "startMs")
            end_ms = _integer(item.get("endMs"), "endMs", minimum=1)
            if (
                chunk_index != expected_index
                or start_ms != previous_end_ms
                or end_ms <= start_ms
                or end_ms > duration_ms
            ):
                raise _error("MEDIA_DISTILLATION_INVALID_JOB", "chunkPlan is invalid")
            chunks.append(
                {"chunkIndex": chunk_index, "startMs": start_ms, "endMs": end_ms}
            )
            previous_end_ms = end_ms
        if previous_end_ms != duration_ms:
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "chunkPlan is invalid")
        return chunks

    def _chunk_grants(
        self,
        value: object,
        *,
        chunk_plan: list[dict[str, int]],
        session_id: str,
        job_id: str,
        attempt_no: int,
        method: str,
    ) -> dict[int, RuntimeGrant]:
        if not isinstance(value, list) or len(value) != len(chunk_plan):
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "chunk grants are invalid")
        grants: dict[int, RuntimeGrant] = {}
        for raw in value:
            item = _record(raw, "chunkGrant")
            chunk_index = _integer(item.get("chunkIndex"), "chunkIndex")
            if chunk_index >= len(chunk_plan) or chunk_index in grants:
                raise _error("MEDIA_DISTILLATION_INVALID_JOB", "chunk grants are invalid")
            parsed = _grant(item, method=method)
            expected_key = (
                f"skill-sessions/{session_id}/jobs/{job_id}/attempt-{attempt_no}/"
                f"transcript-chunks/chunk-{chunk_index:04d}.json"
            )
            if parsed.object_key != expected_key:
                raise _error("MEDIA_DISTILLATION_INVALID_JOB", "chunk grant binding is invalid")
            grants[chunk_index] = parsed
        return grants

    def _recovery_chunk_grants(
        self,
        value: object,
        *,
        chunk_plan: list[dict[str, int]],
        session_id: str,
        job_id: str,
        attempt_no: int,
    ) -> dict[int, list[RuntimeGrant]]:
        expected_count = max(0, attempt_no - 1) * len(chunk_plan)
        if not isinstance(value, list) or len(value) != expected_count:
            raise _error("MEDIA_DISTILLATION_INVALID_JOB", "recovery grants are invalid")
        grouped = {int(chunk["chunkIndex"]): [] for chunk in chunk_plan}
        seen: set[tuple[int, int]] = set()
        for raw in value:
            item = _record(raw, "recoveryGrant")
            prior_attempt = _integer(item.get("attemptNo"), "attemptNo", minimum=1)
            chunk_index = _integer(item.get("chunkIndex"), "chunkIndex")
            identity = (prior_attempt, chunk_index)
            if (
                prior_attempt >= attempt_no
                or chunk_index >= len(chunk_plan)
                or identity in seen
            ):
                raise _error("MEDIA_DISTILLATION_INVALID_JOB", "recovery grants are invalid")
            parsed = _grant(item, method="GET")
            expected_key = (
                f"skill-sessions/{session_id}/jobs/{job_id}/attempt-{prior_attempt}/"
                f"transcript-chunks/chunk-{chunk_index:04d}.json"
            )
            if parsed.object_key != expected_key:
                raise _error("MEDIA_DISTILLATION_INVALID_JOB", "recovery grant binding is invalid")
            grouped[chunk_index].append(parsed)
            seen.add(identity)
        for chunk_grants in grouped.values():
            chunk_grants.reverse()
        return grouped

    def _try_recover_chunk(
        self,
        grant: RuntimeGrant,
        *,
        session_id: str,
        source_id: str,
        audio_sha256: str,
        chunk: dict[str, int],
    ) -> dict[str, object] | None:
        content = bytearray()
        with httpx.Client(timeout=30.0) as client:
            with client.stream("GET", grant.url, headers=grant.headers) as response:
                if response.status_code == 404:
                    return None
                if response.status_code >= 400:
                    retryable = response.status_code >= 500 or response.status_code in {
                        408,
                        409,
                        429,
                    }
                    raise _error(
                        "OBJECT_STORAGE_READ_FAILED",
                        "Recovery manifest download failed",
                        retryable=retryable,
                    )
                for part in response.iter_bytes(64 * 1024):
                    content.extend(part)
                    if len(content) > 4 * 1024 * 1024:
                        raise _error(
                            "MEDIA_DISTILLATION_INVALID_JOB",
                            "Recovery manifest is too large",
                        )
        try:
            parsed = json.loads(bytes(content).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        if not isinstance(parsed, dict):
            return None
        expected_keys = {
            "schemaVersion",
            "jobType",
            "sessionId",
            "sourceId",
            "audioSha256",
            "chunkIndex",
            "startMs",
            "endMs",
            "processorVersion",
            "transcript",
            "degradations",
        }
        if set(parsed) != expected_keys or (
            parsed.get("schemaVersion") != 1
            or parsed.get("jobType") != "transcribe_chunk"
            or parsed.get("sessionId") != session_id
            or parsed.get("sourceId") != source_id
            or parsed.get("audioSha256") != audio_sha256
            or parsed.get("chunkIndex") != chunk["chunkIndex"]
            or parsed.get("startMs") != chunk["startMs"]
            or parsed.get("endMs") != chunk["endMs"]
            or parsed.get("processorVersion") != self._processor_version
        ):
            return None
        transcript = parsed.get("transcript")
        degradations = parsed.get("degradations")
        if (
            not isinstance(transcript, dict)
            or set(transcript) != {"status", "editable", "segments"}
            or transcript.get("status") not in {"ready", "low_confidence"}
            or transcript.get("editable") is not True
            or not isinstance(transcript.get("segments"), list)
            or not isinstance(degradations, list)
        ):
            return None
        previous_end = chunk["startMs"]
        for segment in transcript["segments"]:
            if not isinstance(segment, dict) or set(segment) != {
                "startMs",
                "endMs",
                "text",
                "speaker",
                "confidence",
            }:
                return None
            start_ms = segment.get("startMs")
            end_ms = segment.get("endMs")
            text = segment.get("text")
            confidence = segment.get("confidence")
            if (
                isinstance(start_ms, bool)
                or not isinstance(start_ms, int)
                or isinstance(end_ms, bool)
                or not isinstance(end_ms, int)
                or start_ms < previous_end
                or end_ms <= start_ms
                or end_ms > chunk["endMs"]
                or not isinstance(text, str)
                or not text.strip()
                or (
                    confidence is not None
                    and (
                        isinstance(confidence, bool)
                        or not isinstance(confidence, (int, float))
                        or confidence < 0
                        or confidence > 1
                    )
                )
            ):
                return None
            previous_end = end_ms
        for degradation in degradations:
            if (
                not isinstance(degradation, dict)
                or set(degradation) != {"code", "message"}
                or not isinstance(degradation.get("code"), str)
                or not isinstance(degradation.get("message"), str)
            ):
                return None
        return parsed

    def _materialize_wav_chunk(
        self,
        source_path: Path,
        destination: Path,
        *,
        start_ms: int,
        end_ms: int,
    ) -> None:
        try:
            with wave.open(str(source_path), "rb") as source:
                if (
                    source.getnchannels() != 1
                    or source.getsampwidth() != 2
                    or source.getframerate() != 16_000
                ):
                    raise _error(
                        "MEDIA_DISTILLATION_INVALID_JOB",
                        "Normalized audio format is invalid",
                    )
                start_frame = start_ms * source.getframerate() // 1000
                end_frame = end_ms * source.getframerate() // 1000
                if start_frame >= end_frame or end_frame > source.getnframes():
                    raise _error(
                        "MEDIA_DISTILLATION_INVALID_JOB",
                        "Audio chunk range is invalid",
                    )
                source.setpos(start_frame)
                remaining = end_frame - start_frame
                with destination.open("xb") as raw_output:
                    with wave.open(raw_output, "wb") as output:
                        output.setparams(source.getparams())
                        while remaining > 0:
                            count = min(32_768, remaining)
                            frames = source.readframes(count)
                            if not frames:
                                raise _error(
                                    "MEDIA_DISTILLATION_FAILED",
                                    "Audio chunk materialization failed",
                                )
                            output.writeframesraw(frames)
                            remaining -= len(frames) // 2
        except DistillationExecutionError:
            raise
        except (OSError, wave.Error):
            raise _error(
                "MEDIA_DISTILLATION_FAILED",
                "Audio chunk materialization failed",
            )

    def _download(self, grant: RuntimeGrant, destination: Path, expected_size: int, expected_hash: str) -> None:
        digest = sha256()
        observed = 0
        with httpx.Client(timeout=30.0) as client:
            with client.stream("GET", grant.url, headers=grant.headers) as response:
                if response.status_code >= 400:
                    retryable = response.status_code >= 500 or response.status_code in {408, 409, 429}
                    raise _error("OBJECT_STORAGE_READ_FAILED", "Source download failed", retryable=retryable)
                with destination.open("xb") as output:
                    for chunk in response.iter_bytes(64 * 1024):
                        observed += len(chunk)
                        if observed > expected_size:
                            raise _error("SOURCE_ASSET_MISMATCH", "Source size does not match")
                        digest.update(chunk)
                        output.write(chunk)
        if observed != expected_size or digest.hexdigest() != expected_hash:
            raise _error("SOURCE_ASSET_MISMATCH", "Source asset does not match")

    def _upload_file(self, grant: RuntimeGrant, path: Path, mime_type: str) -> None:
        headers = dict(grant.headers)
        headers.setdefault("content-type", mime_type)
        headers.setdefault("content-length", str(path.stat().st_size))
        with path.open("rb") as source:
            with httpx.Client(timeout=30.0) as client:
                response = client.put(grant.url, headers=headers, content=source)
        if response.status_code < 200 or response.status_code >= 300:
            retryable = response.status_code >= 500 or response.status_code in {408, 409, 429}
            raise _error("OBJECT_STORAGE_WRITE_FAILED", "Artifact upload failed", retryable=retryable)

    def _upload_bytes(self, grant: RuntimeGrant, content: bytes, mime_type: str) -> None:
        headers = dict(grant.headers)
        headers.setdefault("content-type", mime_type)
        with httpx.Client(timeout=30.0) as client:
            response = client.put(grant.url, headers=headers, content=content)
        if response.status_code < 200 or response.status_code >= 300:
            retryable = response.status_code >= 500 or response.status_code in {408, 409, 429}
            raise _error("OBJECT_STORAGE_WRITE_FAILED", "Artifact upload failed", retryable=retryable)

    @staticmethod
    def _result(output: dict[str, object]) -> FakeExecutorResult:
        return FakeExecutorResult(
            result_hash=sha256(canonical_json(output).encode("utf-8")).hexdigest(),
            output_manifest=output,
        )
