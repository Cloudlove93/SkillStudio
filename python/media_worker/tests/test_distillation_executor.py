from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID
import wave

import httpx
import pytest

import media_worker.distillation_executor as module
from media_worker.distillation_executor import DistillationExecutor
from media_worker.errors import DistillationExecutionError
from media_worker.quality_check_executor import RuntimeGrant


def grant(method: str, object_key: str, url: str, content_type: str | None = None) -> dict[str, object]:
    headers = {} if content_type is None else {"content-type": content_type, "if-none-match": "*"}
    return {
        "method": method,
        "objectKey": object_key,
        "url": url,
        "expiresAt": "2026-08-23T01:00:00.000Z",
        "headers": headers,
    }


def silent_wav(duration_ms: int) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16_000)
        wav.writeframes(b"\x00\x00" * (16_000 * duration_ms // 1000))
    return output.getvalue()


def test_refreshed_distillation_grant_cannot_change_the_bound_object_key() -> None:
    original = RuntimeGrant(
        method="PUT",
        object_key="skill-sessions/21/jobs/17/attempt-2/transcript.json",
        url="https://storage.test/expired",
        expires_at="2026-08-24T07:30:00.000Z",
        headers={"content-type": "application/json"},
    )
    changed = RuntimeGrant(
        method="PUT",
        object_key="skill-sessions/another/jobs/17/attempt-2/transcript.json",
        url="https://storage.test/fresh",
        expires_at="2026-08-24T07:40:00.000Z",
        headers={"content-type": "application/json"},
    )

    with pytest.raises(DistillationExecutionError) as error_info:
        module._require_same_object_key(changed, original, "transcript")

    assert error_info.value.code == "MEDIA_DISTILLATION_INVALID_JOB"


def test_media_prepare_downloads_probes_detects_slow_changes_and_uploads_attempt_artifacts(
    monkeypatch,
    httpx_mock,
) -> None:
    source = b"video-source"
    audio = b"normalized-wave"
    uploads: dict[str, bytes] = {}

    httpx_mock.add_response(method="GET", url="https://storage.test/source", content=source)

    def record_upload(request: httpx.Request) -> httpx.Response:
        uploads[str(request.url)] = request.content
        return httpx.Response(200)

    httpx_mock.add_callback(record_upload, method="PUT", url="https://storage.test/fresh-audio")
    httpx_mock.add_callback(record_upload, method="PUT", url="https://storage.test/fresh-result")

    class Probe:
        def __init__(self, **_kwargs) -> None:
            pass

        def probe_media(self, _path: Path, *, source_kind: str | None):
            assert source_kind == "video"
            return SimpleNamespace(duration_ms=120_000, has_audio=True, has_video=True)

    class Ffmpeg:
        def __init__(self, *, workspace_root: Path, **_kwargs) -> None:
            self.workspace_root = workspace_root

        def normalize_audio(self, _path: Path):
            audio_path = self.workspace_root / "audio.wav"
            audio_path.write_bytes(audio)
            return SimpleNamespace(local_path=audio_path)

    class Detector:
        def __init__(self, **_kwargs) -> None:
            pass

        def detect_signals(self, _path: Path, _probe):
            return SimpleNamespace(
                scene_change_timestamps_ms=[10_000],
                slow_visual_change_timestamps_ms=[30_000, 90_000],
                sampled_frame_count=60,
                degradations=[],
            )

    monkeypatch.setattr(module, "FfprobeAdapter", Probe)
    monkeypatch.setattr(module, "FfmpegAdapter", Ffmpeg)
    monkeypatch.setattr(module, "VisualSignalDetector", Detector)
    monkeypatch.setattr(
        Path,
        "read_bytes",
        lambda _path: (_ for _ in ()).throw(
            AssertionError("media artifacts must be streamed, not read into memory")
        ),
    )

    job = {
            "jobId": "701",
            "sessionId": "101",
            "jobType": "media_prepare",
            "attemptNo": 2,
            "inputManifest": {
                "sourceId": "source-video-1",
                "sourceKind": "video",
                "sourceAsset": {
                    "objectKey": "skill-sessions/101/source/video.mp4",
                    "mimeType": "video/mp4",
                    "sizeBytes": len(source),
                    "sha256": sha256(source).hexdigest(),
                },
            },
            "runtimeGrants": {
                "sourceRead": grant(
                    "GET",
                    "skill-sessions/101/source/video.mp4",
                    "https://storage.test/source",
                ),
                "artifactWrites": {
                    "normalizedAudio": grant(
                        "PUT",
                        "skill-sessions/101/jobs/701/attempt-2/normalized-audio.wav",
                        "https://storage.test/audio",
                        "audio/wav",
                    ),
                },
                "resultManifestWrite": grant(
                    "PUT",
                    "skill-sessions/101/jobs/701/attempt-2/result.json",
                    "https://storage.test/result",
                    "application/json",
                ),
            },
        }
    fresh_grants = deepcopy(job["runtimeGrants"])
    fresh_grants["artifactWrites"]["normalizedAudio"]["url"] = (
        "https://storage.test/fresh-audio"
    )
    fresh_grants["resultManifestWrite"]["url"] = "https://storage.test/fresh-result"
    refresh_calls = 0

    def refresh_runtime_grants() -> dict[str, object]:
        nonlocal refresh_calls
        refresh_calls += 1
        return deepcopy(fresh_grants)

    result = DistillationExecutor().run(
        job,
        refresh_runtime_grants=refresh_runtime_grants,
    )

    assert uploads["https://storage.test/fresh-audio"] == audio
    assert uploads["https://storage.test/fresh-result"]
    assert refresh_calls == 2
    assert result.output_manifest["processorVersion"] == "0.1.0"
    assert result.output_manifest["visualSignals"] == {
        "sceneChangeTimestampsMs": [10_000],
        "slowVisualChangeTimestampsMs": [30_000, 90_000],
        "sampledFrameCount": 60,
        "detectorVersion": "0.1.0",
    }
    assert result.output_manifest["normalizedAudioAssetRef"]["objectKey"].endswith(
        "/attempt-2/normalized-audio.wav"
    )


def test_transcribe_emits_timestamped_segments_and_attempt_scoped_manifests(
    httpx_mock,
) -> None:
    audio = b"normalized-wave"
    uploads: dict[str, bytes] = {}
    httpx_mock.add_response(method="GET", url="https://storage.test/audio-read", content=audio)

    def record_upload(request: httpx.Request) -> httpx.Response:
        uploads[str(request.url)] = request.content
        return httpx.Response(200)

    httpx_mock.add_callback(record_upload, method="PUT", url="https://storage.test/fresh-transcript")
    httpx_mock.add_callback(record_upload, method="PUT", url="https://storage.test/fresh-transcript-chunk")
    httpx_mock.add_callback(record_upload, method="PUT", url="https://storage.test/fresh-transcribe-result")

    class Backend:
        def transcribe(self, _audio_path: Path, _config):
            return (
                iter(
                    [
                        SimpleNamespace(
                            start=0.0,
                            end=1.5,
                            text="先定义概念",
                            avg_logprob=-0.1,
                            no_speech_prob=0.05,
                            compression_ratio=1.0,
                        ),
                        SimpleNamespace(
                            start=1.5,
                            end=3.0,
                            text="再演示步骤",
                            avg_logprob=-0.2,
                            no_speech_prob=0.05,
                            compression_ratio=1.0,
                        ),
                    ]
                ),
                SimpleNamespace(language="zh", language_probability=0.95),
            )

    job = {
            "jobId": "702",
            "sessionId": "101",
            "jobType": "transcribe",
            "attemptNo": 1,
            "inputManifest": {
                "sourceId": "source-audio-1",
                "durationMs": 3_000,
                "audioAssetRef": {
                    "objectKey": "skill-sessions/101/jobs/701/attempt-1/normalized-audio.wav",
                    "mimeType": "audio/wav",
                    "sizeBytes": len(audio),
                    "sha256": sha256(audio).hexdigest(),
                },
                "chunkPlan": [
                    {"chunkIndex": 0, "startMs": 0, "endMs": 3_000}
                ],
            },
            "runtimeGrants": {
                "sourceRead": grant(
                    "GET",
                    "skill-sessions/101/jobs/701/attempt-1/normalized-audio.wav",
                    "https://storage.test/audio-read",
                ),
                "artifactWrites": {
                    "transcript": grant(
                        "PUT",
                        "skill-sessions/101/jobs/702/attempt-1/transcript.json",
                        "https://storage.test/transcript",
                        "application/json",
                    ),
                    "transcriptChunks": [
                        {
                            "chunkIndex": 0,
                            **grant(
                                "PUT",
                                "skill-sessions/101/jobs/702/attempt-1/transcript-chunks/chunk-0000.json",
                                "https://storage.test/transcript-chunk",
                                "application/json",
                            ),
                        }
                    ],
                },
                "recoveryReads": {"transcriptChunks": []},
                "resultManifestWrite": grant(
                    "PUT",
                    "skill-sessions/101/jobs/702/attempt-1/result.json",
                    "https://storage.test/transcribe-result",
                    "application/json",
                ),
            },
        }
    fresh_grants = deepcopy(job["runtimeGrants"])
    fresh_grants["artifactWrites"]["transcript"]["url"] = (
        "https://storage.test/fresh-transcript"
    )
    fresh_grants["artifactWrites"]["transcriptChunks"][0]["url"] = (
        "https://storage.test/fresh-transcript-chunk"
    )
    fresh_grants["resultManifestWrite"]["url"] = (
        "https://storage.test/fresh-transcribe-result"
    )
    refresh_calls = 0

    def refresh_runtime_grants() -> dict[str, object]:
        nonlocal refresh_calls
        refresh_calls += 1
        return deepcopy(fresh_grants)

    result = DistillationExecutor(asr_backend=Backend()).run(
        job,
        refresh_runtime_grants=refresh_runtime_grants,
    )

    assert result.output_manifest["transcript"]["segments"] == [
        {
            "startMs": 0,
            "endMs": 1500,
            "text": "先定义概念",
            "speaker": None,
            "confidence": result.output_manifest["transcript"]["segments"][0]["confidence"],
        },
        {
            "startMs": 1500,
            "endMs": 3000,
            "text": "再演示步骤",
            "speaker": None,
            "confidence": result.output_manifest["transcript"]["segments"][1]["confidence"],
        },
    ]
    assert result.output_manifest["transcriptAssetRef"]["objectKey"].endswith(
        "/attempt-1/transcript.json"
    )
    assert uploads["https://storage.test/fresh-transcript"]
    assert uploads["https://storage.test/fresh-transcript-chunk"]
    assert uploads["https://storage.test/fresh-transcribe-result"]
    assert refresh_calls == 3


def test_long_transcription_recovers_valid_chunks_and_only_runs_asr_for_missing_chunks(
    httpx_mock,
) -> None:
    audio = silent_wav(3_000)
    audio_hash = sha256(audio).hexdigest()
    uploads: dict[str, bytes] = {}
    recovered_chunk = {
        "schemaVersion": 1,
        "jobType": "transcribe_chunk",
        "sessionId": "101",
        "sourceId": "source-audio-1",
        "audioSha256": audio_hash,
        "chunkIndex": 0,
        "startMs": 0,
        "endMs": 1_500,
        "processorVersion": "0.1.0",
        "transcript": {
            "status": "ready",
            "editable": True,
            "segments": [
                {
                    "startMs": 0,
                    "endMs": 1_000,
                    "text": "恢复的第一段",
                    "speaker": None,
                    "confidence": 0.95,
                }
            ],
        },
        "degradations": [],
    }
    httpx_mock.add_response(method="GET", url="https://storage.test/long-audio", content=audio)
    httpx_mock.add_response(
        method="GET",
        url="https://storage.test/recover-0",
        json=recovered_chunk,
    )
    httpx_mock.add_response(
        method="GET",
        url="https://storage.test/recover-1",
        status_code=404,
    )

    def record_upload(request: httpx.Request) -> httpx.Response:
        uploads[str(request.url)] = request.content
        return httpx.Response(200)

    for url in [
        "https://storage.test/chunk-0",
        "https://storage.test/chunk-1",
        "https://storage.test/final-transcript",
        "https://storage.test/long-result",
    ]:
        httpx_mock.add_callback(record_upload, method="PUT", url=url)

    class Backend:
        def __init__(self) -> None:
            self.calls = 0

        def transcribe(self, _audio_path: Path, _config):
            self.calls += 1
            return (
                iter(
                    [
                        SimpleNamespace(
                            start=0.0,
                            end=1.5,
                            text="新计算的第二段",
                            avg_logprob=-0.1,
                            no_speech_prob=0.05,
                            compression_ratio=1.0,
                        )
                    ]
                ),
                SimpleNamespace(language="zh", language_probability=0.95),
            )

    backend = Backend()
    result = DistillationExecutor(asr_backend=backend).run(
        {
            "jobId": "702",
            "sessionId": "101",
            "jobType": "transcribe",
            "attemptNo": 2,
            "inputManifest": {
                "sourceId": "source-audio-1",
                "durationMs": 3_000,
                "audioAssetRef": {
                    "objectKey": "skill-sessions/101/jobs/701/attempt-1/normalized-audio.wav",
                    "mimeType": "audio/wav",
                    "sizeBytes": len(audio),
                    "sha256": audio_hash,
                },
                "chunkPlan": [
                    {"chunkIndex": 0, "startMs": 0, "endMs": 1_500},
                    {"chunkIndex": 1, "startMs": 1_500, "endMs": 3_000},
                ],
            },
            "runtimeGrants": {
                "sourceRead": grant(
                    "GET",
                    "skill-sessions/101/jobs/701/attempt-1/normalized-audio.wav",
                    "https://storage.test/long-audio",
                ),
                "artifactWrites": {
                    "transcript": grant(
                        "PUT",
                        "skill-sessions/101/jobs/702/attempt-2/transcript.json",
                        "https://storage.test/final-transcript",
                        "application/json",
                    ),
                    "transcriptChunks": [
                        {
                            "chunkIndex": 0,
                            **grant(
                                "PUT",
                                "skill-sessions/101/jobs/702/attempt-2/transcript-chunks/chunk-0000.json",
                                "https://storage.test/chunk-0",
                                "application/json",
                            ),
                        },
                        {
                            "chunkIndex": 1,
                            **grant(
                                "PUT",
                                "skill-sessions/101/jobs/702/attempt-2/transcript-chunks/chunk-0001.json",
                                "https://storage.test/chunk-1",
                                "application/json",
                            ),
                        },
                    ],
                },
                "recoveryReads": {
                    "transcriptChunks": [
                        {
                            "attemptNo": 1,
                            "chunkIndex": 0,
                            **grant(
                                "GET",
                                "skill-sessions/101/jobs/702/attempt-1/transcript-chunks/chunk-0000.json",
                                "https://storage.test/recover-0",
                            ),
                        },
                        {
                            "attemptNo": 1,
                            "chunkIndex": 1,
                            **grant(
                                "GET",
                                "skill-sessions/101/jobs/702/attempt-1/transcript-chunks/chunk-0001.json",
                                "https://storage.test/recover-1",
                            ),
                        },
                    ],
                },
                "resultManifestWrite": grant(
                    "PUT",
                    "skill-sessions/101/jobs/702/attempt-2/result.json",
                    "https://storage.test/long-result",
                    "application/json",
                ),
            },
        }
    )

    assert backend.calls == 1
    assert result.output_manifest["transcript"]["segments"] == [
        {
            "startMs": 0,
            "endMs": 1_000,
            "text": "恢复的第一段",
            "speaker": None,
            "confidence": 0.95,
        },
        {
            "startMs": 1_500,
            "endMs": 3_000,
            "text": "新计算的第二段",
            "speaker": None,
            "confidence": result.output_manifest["transcript"]["segments"][1]["confidence"],
        },
    ]
    assert json.loads(uploads["https://storage.test/chunk-0"])["chunkIndex"] == 0
    assert json.loads(uploads["https://storage.test/chunk-1"])["chunkIndex"] == 1
    final_manifest = json.loads(uploads["https://storage.test/final-transcript"])
    assert len(final_manifest["chunkManifestRefs"]) == 2


def test_frame_materialize_streams_each_candidate_and_preserves_quality_binding(
    monkeypatch,
    httpx_mock,
) -> None:
    source = b"video-source"
    frame_png = b"png-frame-content"
    uploads: dict[str, bytes] = {}
    httpx_mock.add_response(method="GET", url="https://storage.test/video-read", content=source)

    def record_upload(request: httpx.Request) -> httpx.Response:
        uploads[str(request.url)] = request.content
        return httpx.Response(200)

    httpx_mock.add_callback(record_upload, method="PUT", url="https://storage.test/fresh-frame")
    httpx_mock.add_callback(record_upload, method="PUT", url="https://storage.test/fresh-frame-result")

    class Probe:
        def __init__(self, **_kwargs) -> None:
            pass

    class Materializer:
        def __init__(self, *, workspace_root: Path, config, **_kwargs) -> None:
            self.workspace_root = workspace_root
            output_token = config.create_output_token()
            assert str(UUID(output_token)) == output_token

        def materialize_frames(self, _video_path: Path, *, requests):
            output = self.workspace_root / "frame.png"
            output.write_bytes(frame_png)
            request = requests[0]
            return [
                SimpleNamespace(
                    candidate_id=request.candidate_id,
                    semantic_moment_id=request.semantic_moment_id,
                    timestamp_ms=request.timestamp_ms,
                    source_signal=request.source_signal,
                    selection_reason=request.selection_reason,
                    local_path=output,
                )
            ]

    class Assessor:
        def __init__(self, **_kwargs) -> None:
            pass

        def assess_frames(self, frames):
            frame = frames[0]
            return [
                SimpleNamespace(
                    candidate_id=frame.candidate_id,
                    semantic_moment_id=frame.semantic_moment_id,
                    timestamp_ms=frame.timestamp_ms,
                    source_signal=frame.source_signal,
                    selection_reason=frame.selection_reason,
                    metrics={
                        "analysisWidth": 320,
                        "analysisHeight": 180,
                        "brightnessMeanNormalized": 0.5,
                        "blackPixelRatio": 0.01,
                        "whitePixelRatio": 0.2,
                        "entropyNormalized": 0.7,
                        "sharpness": {
                            "algorithm": "laplacian_variance_4_neighbour_normalized",
                            "normalized": True,
                            "value": 0.8,
                        },
                        "duplicateHash": {
                            "algorithm": "dhash_64",
                            "value": "0123456789abcdef",
                        },
                    },
                    hard_rejected_reasons=[],
                    suppressed=False,
                    duplicate_of=None,
                )
            ]

    monkeypatch.setattr(module, "FfprobeAdapter", Probe)
    monkeypatch.setattr(module, "FrameMaterializer", Materializer)
    monkeypatch.setattr(module, "FrameQualityAssessor", Assessor)
    monkeypatch.setattr(
        Path,
        "read_bytes",
        lambda _path: (_ for _ in ()).throw(
            AssertionError("frame artifacts must be streamed")
        ),
    )

    job = {
            "jobId": "703",
            "sessionId": "101",
            "jobType": "frame_materialize",
            "attemptNo": 1,
            "inputManifest": {
                "sourceId": "source-video-1",
                "sourceAsset": {
                    "objectKey": "skill-sessions/101/source/video.mp4",
                    "mimeType": "video/mp4",
                    "sizeBytes": len(source),
                    "sha256": sha256(source).hexdigest(),
                },
                "frameRequests": [
                    {
                        "candidateId": "frame-001",
                        "semanticMomentId": "moment-001",
                        "timestampMs": 1000,
                        "sourceSignal": "slow_visual_change",
                        "selectionReason": "board writing accumulated",
                    }
                ],
            },
            "runtimeGrants": {
                "sourceRead": grant(
                    "GET",
                    "skill-sessions/101/source/video.mp4",
                    "https://storage.test/video-read",
                ),
                "artifactWrites": {
                    "frames": [
                        {
                            "candidateId": "frame-001",
                            **grant(
                                "PUT",
                                "skill-sessions/101/jobs/703/attempt-1/frames/frame-001.png",
                                "https://storage.test/frame",
                                "image/png",
                            ),
                        }
                    ]
                },
                "resultManifestWrite": grant(
                    "PUT",
                    "skill-sessions/101/jobs/703/attempt-1/result.json",
                    "https://storage.test/frame-result",
                    "application/json",
                ),
            },
        }
    fresh_grants = deepcopy(job["runtimeGrants"])
    fresh_grants["artifactWrites"]["frames"][0]["url"] = (
        "https://storage.test/fresh-frame"
    )
    fresh_grants["resultManifestWrite"]["url"] = (
        "https://storage.test/fresh-frame-result"
    )
    refresh_calls = 0

    def refresh_runtime_grants() -> dict[str, object]:
        nonlocal refresh_calls
        refresh_calls += 1
        return deepcopy(fresh_grants)

    result = DistillationExecutor().run(
        job,
        refresh_runtime_grants=refresh_runtime_grants,
    )

    candidate = result.output_manifest["candidates"][0]
    assert candidate["assetRef"]["sha256"] == sha256(frame_png).hexdigest()
    assert candidate["sourceSignal"] == "slow_visual_change"
    assert candidate["metrics"]["duplicateHash"]["value"] == "0123456789abcdef"
    assert uploads["https://storage.test/fresh-frame"] == frame_png
    assert uploads["https://storage.test/fresh-frame-result"]
    assert refresh_calls == 2
