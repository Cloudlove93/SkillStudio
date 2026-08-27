from __future__ import annotations

from copy import deepcopy
import json
import threading
import time
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

import httpx
import pytest

from media_worker.errors import MediaAdapterError, QualityCheckExecutionError
from media_worker.quality_check_executor import (
    PROCESSOR_VERSION,
    QualityCheckExecutor,
    _HeartbeatKeeper,
)

FIXTURE_DIR = Path(__file__).parent / "fixtures"


def test_heartbeat_keeper_surfaces_an_immediate_callback_failure() -> None:
    expected = RuntimeError("heartbeat rejected")

    def reject(_progress: dict[str, object]) -> None:
        raise expected

    keeper = _HeartbeatKeeper(report_progress=reject, interval_seconds=15.0)

    with pytest.raises(RuntimeError) as error_info:
        keeper.update({"phase": "transcribing_audio", "percent": 20})

    assert error_info.value is expected


class StubProbeResult:
    def __init__(self, *, degradation=None) -> None:
        self.duration_ms = 1250
        self.format_name = "wav"
        self.size_bytes = 2048
        self.bit_rate = 64000
        self.has_audio = True
        self.has_video = False
        self.primary_audio_stream_index = 0
        self.primary_video_stream_index = None
        self.streams = [
            {
                "index": 0,
                "codecType": "audio",
                "codecName": "pcm_s16le",
                "durationMs": 1250,
                "timeBase": "1/16000",
                "disposition": {"default": True, "attachedPic": False},
                "audio": {"sampleRate": 16000, "channels": 1, "channelLayout": "mono"},
            }
        ]
        self.ffprobe_version = "8.1.1"
        self.degradation = degradation

    def to_manifest(self) -> dict[str, object]:
        return {
            "durationMs": self.duration_ms,
            "formatName": self.format_name,
            "sizeBytes": self.size_bytes,
            "bitRate": self.bit_rate,
            "hasAudio": self.has_audio,
            "hasVideo": self.has_video,
            "primaryAudioStreamIndex": self.primary_audio_stream_index,
            "primaryVideoStreamIndex": self.primary_video_stream_index,
            "streams": self.streams,
            "ffprobeVersion": self.ffprobe_version,
            "degradation": self.degradation,
        }


class StubAdapter:
    def __init__(self, probe_result: StubProbeResult) -> None:
        self.probe_result = probe_result
        self.calls: list[tuple[Path, str | None]] = []

    def probe_media(self, input_path: Path, *, source_kind: str | None):
        self.calls.append((input_path, source_kind))
        return self.probe_result


class StreamingResponse:
    def __init__(
        self,
        *,
        chunks: list[bytes],
        headers: dict[str, str],
        status_code: int = 200,
    ) -> None:
        self._chunks = chunks
        self.headers = headers
        self.status_code = status_code
        self.entered = False

    def __enter__(self) -> "StreamingResponse":
        self.entered = True
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def iter_bytes(self):
        for chunk in self._chunks:
            yield chunk


class StreamingClient:
    def __init__(self, response: StreamingResponse) -> None:
        self._response = response
        self.put_bodies: list[bytes] = []

    def __enter__(self) -> "StreamingClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def stream(self, method: str, url: str, headers: dict[str, str]):
        assert method == "GET"
        assert url == "https://signed.example/source"
        assert headers == {}
        return self._response

    def put(self, url: str, *, headers: dict[str, str], content: bytes) -> httpx.Response:
        assert url == "https://signed.example/manifest"
        self.put_bodies.append(content)
        return httpx.Response(200)


def make_claim(*, media_kind: str = "audio") -> dict[str, object]:
    return {
        "jobId": "3001",
        "sessionId": "88",
        "jobType": "media_quality_check",
        "attemptNo": 1,
        "maxAttempts": 3,
        "inputManifest": {
          "schemaVersion": 1,
          "sourceId": "source-upload-1",
          "mediaKind": media_kind,
          "objectKey": "skill-sessions/88/source/source.wav" if media_kind == "audio" else "skill-sessions/88/source/source.mp4",
          "fileName": "source.wav" if media_kind == "audio" else "source.mp4",
          "expectedSizeBytes": 4,
          "expectedContentType": "audio/wav" if media_kind == "audio" else "video/mp4",
          "uploadMode": "single_put",
        },
        "progress": {},
        "leaseToken": "lease-1",
        "leaseExpiresAt": "2026-08-21T00:01:00.000Z",
        "runtimeGrants": {
            "sourceRead": {
                "method": "GET",
                "objectKey": "skill-sessions/88/source/source.wav" if media_kind == "audio" else "skill-sessions/88/source/source.mp4",
                "url": "https://signed.example/source",
                "expiresAt": "2026-08-21T00:10:00.000Z",
                "headers": {},
            },
            "resultManifestWrite": {
                "method": "PUT",
                "objectKey": "skill-sessions/88/manifest/media-quality-check/job-3001-attempt-1.json",
                "url": "https://signed.example/manifest",
                "expiresAt": "2026-08-21T00:10:00.000Z",
                "headers": {"content-type": "application/json", "if-none-match": "*"},
            },
        },
    }


def test_downloads_hashes_probes_and_uploads_full_quality_manifest(httpx_mock) -> None:
    source_bytes = b"RIFF"
    captured_progress: list[dict[str, object]] = []
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=source_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    uploaded_bodies: list[bytes] = []

    def upload_callback(request):
        uploaded_bodies.append(request.content)
        return httpx.Response(200)

    import httpx

    httpx_mock.add_callback(upload_callback, method="PUT", url="https://signed.example/manifest")
    adapter = StubAdapter(StubProbeResult())
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: adapter,
    )

    result = executor.run(
        make_claim(),
        report_progress=captured_progress.append,
    )

    assert captured_progress[0] == {"phase": "downloading_source", "percent": 15}
    assert {"phase": "probing_media", "percent": 55} in captured_progress
    assert {"phase": "uploading_result_manifest", "percent": 85} in captured_progress
    assert result.output_manifest["processorVersion"] == PROCESSOR_VERSION
    assert result.output_manifest["resultManifestRef"]["objectKey"] == (
        "skill-sessions/88/manifest/media-quality-check/job-3001-attempt-1.json"
    )
    assert result.output_manifest["sourceAsset"]["sha256"] == sha256(source_bytes).hexdigest()
    uploaded_manifest = json.loads(uploaded_bodies[0].decode("utf-8"))
    assert uploaded_manifest["sourceAsset"]["sha256"] == sha256(source_bytes).hexdigest()
    assert uploaded_manifest["probe"]["streams"][0]["codecType"] == "audio"
    assert adapter.calls[0][1] == "audio"


def test_quality_check_uploads_with_a_fresh_bound_result_grant(httpx_mock) -> None:
    source_bytes = b"RIFF"
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=source_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    uploaded: list[bytes] = []

    def upload_callback(request: httpx.Request) -> httpx.Response:
        uploaded.append(request.content)
        return httpx.Response(200)

    httpx_mock.add_callback(
        upload_callback,
        method="PUT",
        url="https://signed.example/fresh-manifest",
    )
    claim = make_claim()
    fresh_grants = deepcopy(claim["runtimeGrants"])
    fresh_grants["resultManifestWrite"]["url"] = (
        "https://signed.example/fresh-manifest"
    )

    result = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda _workspace_root: StubAdapter(StubProbeResult()),
    ).run(
        claim,
        refresh_runtime_grants=lambda: deepcopy(fresh_grants),
    )

    assert uploaded
    assert result.output_manifest["resultManifestRef"]["objectKey"] == (
        "skill-sessions/88/manifest/media-quality-check/job-3001-attempt-1.json"
    )


def test_quality_check_rejects_a_refreshed_result_grant_with_another_key(
    monkeypatch: pytest.MonkeyPatch,
    httpx_mock,
) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "audio/wav"},
    )
    claim = make_claim()
    fresh_grants = deepcopy(claim["runtimeGrants"])
    fresh_grants["resultManifestWrite"]["objectKey"] = (
        "skill-sessions/attacker/result.json"
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda _workspace_root: StubAdapter(StubProbeResult()),
    )
    monkeypatch.setattr(
        executor,
        "_upload_manifest",
        lambda *_args: (_ for _ in ()).throw(AssertionError("upload must not run")),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(
            claim,
            refresh_runtime_grants=lambda: deepcopy(fresh_grants),
        )

    assert error_info.value.code == "MEDIA_QUALITY_CHECK_INVALID_JOB"


def test_reports_multiple_download_progress_heartbeats_while_streaming_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = StreamingResponse(
        chunks=[b"RI", b"FF", b"00", b"11"],
        headers={"content-type": "audio/wav"},
    )
    client = StreamingClient(response)
    now_values = iter(
        [
            datetime(2026, 8, 23, 0, 0, 0, tzinfo=timezone.utc),
            datetime(2026, 8, 23, 0, 0, 6, tzinfo=timezone.utc),
            datetime(2026, 8, 23, 0, 0, 12, tzinfo=timezone.utc),
            datetime(2026, 8, 23, 0, 0, 18, tzinfo=timezone.utc),
            datetime(2026, 8, 23, 0, 0, 24, tzinfo=timezone.utc),
            datetime(2026, 8, 23, 0, 0, 30, tzinfo=timezone.utc),
        ]
    )
    monkeypatch.setattr(httpx, "Client", lambda timeout=30.0: client)
    progress_events: list[dict[str, object]] = []
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
        now=lambda: next(now_values),
    )
    claim = make_claim()
    claim["inputManifest"] = {**claim["inputManifest"], "expectedSizeBytes": 8}

    result = executor.run(
        claim,
        report_progress=progress_events.append,
    )

    download_events = [
        event for event in progress_events if event["phase"] == "downloading_source"
    ]
    assert result.output_manifest["sourceAsset"]["sizeBytes"] == 8
    assert len(download_events) > 1
    assert len(download_events) < 5
    assert client.put_bodies


def test_keeps_heartbeating_during_slow_probe_and_manifest_upload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class SlowAdapter(StubAdapter):
        def probe_media(self, input_path: Path, *, source_kind: str | None):
            time.sleep(0.04)
            return super().probe_media(input_path, source_kind=source_kind)

    class SlowClient(StreamingClient):
        def put(self, url: str, *, headers: dict[str, str], content: bytes) -> httpx.Response:
            time.sleep(0.04)
            return super().put(url, headers=headers, content=content)

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda timeout=30.0: SlowClient(
            StreamingResponse(
                chunks=[b"RIFF"],
                headers={"content-type": "audio/wav"},
            )
        ),
    )
    progress_events: list[dict[str, object]] = []
    thread_names_before = {
        thread.name for thread in threading.enumerate()
    }
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: SlowAdapter(StubProbeResult()),
        heartbeat_interval_seconds=0.01,
    )

    executor.run(make_claim(), report_progress=progress_events.append)

    probe_events = [
        event for event in progress_events if event["phase"] == "probing_media"
    ]
    upload_events = [
        event
        for event in progress_events
        if event["phase"] == "uploading_result_manifest"
    ]
    assert len(probe_events) >= 2
    assert len(upload_events) >= 2
    assert not any(
        thread.name.startswith("educlaw-quality-heartbeat")
        and thread.name not in thread_names_before
        for thread in threading.enumerate()
    )


def test_reraises_retryable_progress_api_errors_from_heartbeat_keeper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class SlowAdapter(StubAdapter):
        def probe_media(self, input_path: Path, *, source_kind: str | None):
            time.sleep(0.03)
            return super().probe_media(input_path, source_kind=source_kind)

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda timeout=30.0: StreamingClient(
            StreamingResponse(
                chunks=[b"RIFF"],
                headers={"content-type": "audio/wav"},
            )
        ),
    )
    calls = 0

    def report_progress(_: dict[str, object]) -> None:
        nonlocal calls
        calls += 1
        if calls >= 2:
            raise httpx.ConnectError("temporary heartbeat failure")

    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: SlowAdapter(StubProbeResult()),
        heartbeat_interval_seconds=0.01,
    )

    with pytest.raises(httpx.ConnectError):
        executor.run(make_claim(), report_progress=report_progress)


def test_stops_downloading_when_source_exceeds_expected_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    iterated_chunks: list[int] = []

    class OversizeResponse(StreamingResponse):
        def iter_bytes(self):
            for index, chunk in enumerate([b"12345", b"67890"], start=1):
                iterated_chunks.append(index)
                yield chunk

    monkeypatch.setattr(
        httpx,
        "Client",
        lambda timeout=30.0: StreamingClient(
            OversizeResponse(
                chunks=[],
                headers={"Content-Type": "audio/wav"},
            )
        ),
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "FILE_MISMATCH"
    assert iterated_chunks == [1]


def test_rejects_size_mismatch_without_uploading_manifest(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFFXX",
        headers={"Content-Type": "audio/wav"},
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "FILE_MISMATCH"
    assert error_info.value.retryable is False


def test_reports_retryable_manifest_upload_failures_without_leaking_signed_url(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "audio/wav"},
    )
    httpx_mock.add_response(
        method="PUT",
        url="https://signed.example/manifest",
        status_code=503,
        text="temporary failure",
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    error = error_info.value
    assert error.code == "QUALITY_RESULT_MANIFEST_UPLOAD_FAILED"
    assert error.retryable is True
    assert "signed.example" not in str(error)


def test_preserves_visual_only_degradation_for_video_without_audio(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"....",
        headers={"Content-Type": "video/mp4"},
    )
    httpx_mock.add_response(
        method="PUT",
        url="https://signed.example/manifest",
        status_code=200,
    )
    adapter = StubAdapter(
        StubProbeResult(degradation={"mode": "visual_only", "reason": "no_audio_track"})
    )
    adapter.probe_result.has_audio = False
    adapter.probe_result.has_video = True
    adapter.probe_result.format_name = "mov,mp4,m4a,3gp,3g2,mj2"
    adapter.probe_result.streams = [
        {
            "index": 0,
            "codecType": "video",
            "codecName": "h264",
            "durationMs": 1250,
            "timeBase": "1/1000",
            "disposition": {"default": True, "attachedPic": False},
            "video": {"width": 1280, "height": 720, "avgFrameRate": 25.0},
        }
    ]
    adapter.probe_result.primary_audio_stream_index = None
    adapter.probe_result.primary_video_stream_index = 0
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: adapter,
    )

    result = executor.run(make_claim(media_kind="video"))

    assert result.output_manifest["degradations"] == [
        {"code": "VISUAL_ONLY", "message": "no_audio_track"}
    ]


def test_rejects_audio_manifest_when_probe_trusted_container_mime_disagrees(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"....",
        headers={"Content-Type": "audio/wav"},
    )
    adapter = StubAdapter(StubProbeResult())
    adapter.probe_result.format_name = "mov,mp4,m4a,3gp,3g2,mj2"
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: adapter,
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "FILE_MISMATCH"
    assert error_info.value.retryable is False


def test_downloads_probes_and_uploads_video_with_audio_and_video_tracks(httpx_mock) -> None:
    source_bytes = b"fake-mp4-content"
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=source_bytes,
        headers={"Content-Type": "video/mp4"},
    )
    httpx_mock.add_response(
        method="PUT",
        url="https://signed.example/manifest",
        status_code=200,
    )
    adapter = StubAdapter(StubProbeResult())
    adapter.probe_result.has_audio = True
    adapter.probe_result.has_video = True
    adapter.probe_result.format_name = "mov,mp4,m4a,3gp,3g2,mj2"
    adapter.probe_result.streams = [
        {
            "index": 0,
            "codecType": "video",
            "codecName": "h264",
            "durationMs": 5000,
            "timeBase": "1/1000",
            "disposition": {"default": True, "attachedPic": False},
            "video": {"width": 1920, "height": 1080, "avgFrameRate": 30.0},
        },
        {
            "index": 1,
            "codecType": "audio",
            "codecName": "aac",
            "durationMs": 5000,
            "timeBase": "1/48000",
            "disposition": {"default": True, "attachedPic": False},
            "audio": {"sampleRate": 48000, "channels": 2, "channelLayout": "stereo"},
        },
    ]
    adapter.probe_result.primary_audio_stream_index = 1
    adapter.probe_result.primary_video_stream_index = 0
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: adapter,
    )

    claim = make_claim(media_kind="video")
    claim["inputManifest"] = {**claim["inputManifest"], "expectedSizeBytes": len(source_bytes)}
    result = executor.run(claim)

    assert result.output_manifest["sourceKind"] == "video"
    assert result.output_manifest["sourceAsset"]["sha256"] == sha256(source_bytes).hexdigest()
    assert result.output_manifest["sourceAsset"]["mimeType"] == "video/mp4"
    assert result.output_manifest["probe"]["hasAudio"] is True
    assert result.output_manifest["probe"]["hasVideo"] is True
    assert result.output_manifest["probe"]["audioStreamCount"] == 1
    assert result.output_manifest["probe"]["videoStreamCount"] == 1
    assert result.output_manifest["probe"]["primaryAudioStreamIndex"] == 1
    assert result.output_manifest["probe"]["primaryVideoStreamIndex"] == 0
    assert result.output_manifest["degradations"] == []
    assert adapter.calls[0][1] == "video"


def test_rejects_content_type_mismatch_as_non_retryable(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "video/mp4"},
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim(media_kind="audio"))

    assert error_info.value.code == "FILE_MISMATCH"
    assert error_info.value.retryable is False


def test_rejects_video_manifest_when_probe_reports_audio_only_content(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"fake-mp4-content",
        headers={"Content-Type": "video/mp4"},
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim(media_kind="video"))

    assert error_info.value.code == "FILE_MISMATCH"
    assert error_info.value.retryable is False


def test_handles_download_404_as_non_retryable(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        status_code=404,
        text="not found",
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "UPLOAD_NOT_FOUND"
    assert error_info.value.retryable is False


def test_handles_download_500_as_retryable(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        status_code=500,
        text="internal error",
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "MULTIMODAL_UPLOAD_UNAVAILABLE"
    assert error_info.value.retryable is True


def test_handles_download_403_as_retryable(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        status_code=403,
        text="forbidden",
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "MULTIMODAL_UPLOAD_UNAVAILABLE"
    assert error_info.value.retryable is True


def test_handles_download_http_error_as_retryable(httpx_mock) -> None:
    httpx_mock.add_exception(
        httpx.ConnectError("connection refused"),
        method="GET",
        url="https://signed.example/source",
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "MULTIMODAL_UPLOAD_UNAVAILABLE"
    assert error_info.value.retryable is True
    assert "signed.example" not in str(error_info.value)


def test_handles_probe_timeout_as_retryable(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "audio/wav"},
    )

    class TimeoutAdapter:
        def probe_media(self, input_path: Path, *, source_kind: str | None):
            raise MediaAdapterError(
                "MEDIA_PROBE_TIMEOUT",
                "Probe timed out after 30s",
                retryable=True,
            )

    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: TimeoutAdapter(),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "MEDIA_PROBE_TIMEOUT"
    assert error_info.value.retryable is True


def test_handles_probe_unsupported_as_non_retryable(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "audio/wav"},
    )

    class UnsupportedAdapter:
        def probe_media(self, input_path: Path, *, source_kind: str | None):
            raise MediaAdapterError(
                "MEDIA_PROBE_UNSUPPORTED",
                "Unsupported media format",
                retryable=False,
            )

    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: UnsupportedAdapter(),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "MEDIA_PROBE_UNSUPPORTED"
    assert error_info.value.retryable is False


def test_handles_probe_generic_failure_as_non_retryable(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "audio/wav"},
    )

    class BrokenAdapter:
        def probe_media(self, input_path: Path, *, source_kind: str | None):
            raise MediaAdapterError(
                "MEDIA_PROBE_BROKEN",
                "ffprobe crashed",
                retryable=False,
            )

    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: BrokenAdapter(),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "MEDIA_PROBE_FAILED"
    assert error_info.value.retryable is False


def test_handles_manifest_upload_http_error_as_retryable(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "audio/wav"},
    )
    httpx_mock.add_exception(
        httpx.ConnectError("connection refused"),
        method="PUT",
        url="https://signed.example/manifest",
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "QUALITY_RESULT_MANIFEST_UPLOAD_FAILED"
    assert error_info.value.retryable is True
    assert "signed.example" not in str(error_info.value)


def test_manifest_upload_409_is_retryable(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "audio/wav"},
    )
    httpx_mock.add_response(
        method="PUT",
        url="https://signed.example/manifest",
        status_code=409,
        text="conflict",
    )
    executor = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: StubAdapter(StubProbeResult()),
    )

    with pytest.raises(QualityCheckExecutionError) as error_info:
        executor.run(make_claim())

    assert error_info.value.code == "QUALITY_RESULT_MANIFEST_UPLOAD_FAILED"
    assert error_info.value.retryable is True


def test_two_executors_use_independent_workspace_directories(httpx_mock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "audio/wav"},
    )
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=b"RIFF",
        headers={"Content-Type": "audio/wav"},
    )
    httpx_mock.add_response(
        method="PUT",
        url="https://signed.example/manifest",
        status_code=200,
    )
    httpx_mock.add_response(
        method="PUT",
        url="https://signed.example/manifest",
        status_code=200,
    )
    adapter_a = StubAdapter(StubProbeResult())
    adapter_b = StubAdapter(StubProbeResult())
    executor_a = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: adapter_a,
    )
    executor_b = QualityCheckExecutor(
        ffprobe_adapter_factory=lambda workspace_root: adapter_b,
    )

    claim_a = make_claim()
    claim_b = make_claim()
    claim_b["jobId"] = "3002"
    claim_b["sessionId"] = "89"
    claim_b["runtimeGrants"]["resultManifestWrite"]["objectKey"] = (
        "skill-sessions/89/manifest/media-quality-check/job-3002-attempt-1.json"
    )

    result_a = executor_a.run(claim_a)
    result_b = executor_b.run(claim_b)

    assert result_a.result_hash != result_b.result_hash
    assert adapter_a.calls[0][0] != adapter_b.calls[0][0]
    assert result_a.output_manifest["sessionId"] == "88"
    assert result_b.output_manifest["sessionId"] == "89"


def test_real_audio_fixture_runs_through_default_ffprobe_executor(httpx_mock) -> None:
    fixture_bytes = (FIXTURE_DIR / "audio-short.wav").read_bytes()
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=fixture_bytes,
        headers={"Content-Type": "audio/wav"},
    )
    uploaded_manifests: list[dict[str, object]] = []
    httpx_mock.add_callback(
        lambda request: (
            uploaded_manifests.append(json.loads(request.content.decode("utf-8"))),
            httpx.Response(200),
        )[1],
        method="PUT",
        url="https://signed.example/manifest",
    )
    executor = QualityCheckExecutor()
    claim = make_claim()
    claim["inputManifest"] = {
        **claim["inputManifest"],
        "expectedSizeBytes": len(fixture_bytes),
    }

    result = executor.run(claim)

    assert result.output_manifest["processorVersion"] == PROCESSOR_VERSION
    assert result.output_manifest["sourceKind"] == "audio"
    assert result.output_manifest["sourceAsset"]["sizeBytes"] == len(fixture_bytes)
    assert result.output_manifest["sourceAsset"]["mimeType"] == "audio/wav"
    assert result.output_manifest["probe"]["hasAudio"] is True
    assert result.output_manifest["probe"]["hasVideo"] is False
    assert uploaded_manifests[0]["probe"]["formatName"] == "wav"


def test_real_video_fixture_runs_through_default_ffprobe_executor(httpx_mock) -> None:
    fixture_bytes = (FIXTURE_DIR / "video-with-audio.mp4").read_bytes()
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=fixture_bytes,
        headers={"Content-Type": "video/mp4"},
    )
    httpx_mock.add_response(
        method="PUT",
        url="https://signed.example/manifest",
        status_code=200,
    )
    executor = QualityCheckExecutor()
    claim = make_claim(media_kind="video")
    claim["inputManifest"] = {
        **claim["inputManifest"],
        "expectedSizeBytes": len(fixture_bytes),
    }

    result = executor.run(claim)

    assert result.output_manifest["sourceKind"] == "video"
    assert result.output_manifest["sourceAsset"]["mimeType"] == "video/mp4"
    assert result.output_manifest["probe"]["hasAudio"] is True
    assert result.output_manifest["probe"]["hasVideo"] is True
    assert result.output_manifest["degradations"] == []


def test_real_visual_only_video_fixture_reports_degradation(httpx_mock) -> None:
    fixture_bytes = (FIXTURE_DIR / "video-no-audio.mp4").read_bytes()
    httpx_mock.add_response(
        method="GET",
        url="https://signed.example/source",
        content=fixture_bytes,
        headers={"Content-Type": "video/mp4"},
    )
    httpx_mock.add_response(
        method="PUT",
        url="https://signed.example/manifest",
        status_code=200,
    )
    executor = QualityCheckExecutor()
    claim = make_claim(media_kind="video")
    claim["inputManifest"] = {
        **claim["inputManifest"],
        "expectedSizeBytes": len(fixture_bytes),
    }

    result = executor.run(claim)

    assert result.output_manifest["probe"]["hasAudio"] is False
    assert result.output_manifest["probe"]["hasVideo"] is True
    assert result.output_manifest["degradations"] == [
        {"code": "VISUAL_ONLY", "message": "no_audio_track"}
    ]
