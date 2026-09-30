from __future__ import annotations

import logging
import os
import json
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

import pytest

from media_worker.config import EXECUTOR_MODE_CONTRACT_ONLY_FAKE, WorkerConfig
from media_worker.errors import (
    FakeExecutionError,
    InternalApiError,
    QualityCheckExecutionError,
)
from media_worker.fake_executor import FakeExecutor, FakeExecutorResult, canonical_json
from media_worker.worker_main import WorkerRunner, main


def make_config() -> WorkerConfig:
    return WorkerConfig(
        base_url="http://node.test/api",
        service_token="worker-secret-token",
        worker_identity="worker-a",
        request_timeout_seconds=5.0,
        poll_interval_seconds=2.5,
        accepted_job_types=("transcribe", "media_quality_check"),
        executor_mode=EXECUTOR_MODE_CONTRACT_ONLY_FAKE,
        max_media_duration_ms=12 * 60 * 60 * 1000,
        heartbeat_interval_seconds=15.0,
    )


def make_job() -> dict[str, object]:
    return {
        "jobId": "3001",
        "sessionId": "88",
        "jobType": "transcribe",
        "attemptNo": 1,
        "maxAttempts": 3,
        "inputManifest": {"sourceObjectKey": "skill-sessions/88/source.wav"},
        "progress": {},
        "leaseToken": "lease-1",
        "leaseExpiresAt": "2026-08-21T00:01:00.000Z",
    }


class RecordingClient:
    def __init__(
        self,
        *,
        claim_effects: list[object] | None = None,
        heartbeat_effects: list[object] | None = None,
        refresh_effects: list[object] | None = None,
        complete_effects: list[object] | None = None,
        fail_effects: list[object] | None = None,
    ) -> None:
        self.claim_effects = list(claim_effects or [None])
        self.heartbeat_effects = list(heartbeat_effects or [{"ok": True}])
        self.refresh_effects = list(refresh_effects or [{}])
        self.complete_effects = list(complete_effects or [{"ok": True}])
        self.fail_effects = list(fail_effects or [{"ok": True}])
        self.calls: list[tuple[str, tuple[object, ...], dict[str, object]]] = []
        self.closed = False

    def _next(self, effects: list[object], label: str) -> object:
        if not effects:
            raise AssertionError(f"no effect configured for {label}")
        effect = effects.pop(0)
        if isinstance(effect, Exception):
            raise effect
        return effect

    def claim(
        self, *, worker_identity: str, accepted_job_types: list[str]
    ) -> dict[str, object] | None:
        self.calls.append(
            (
                "claim",
                (),
                {
                    "worker_identity": worker_identity,
                    "accepted_job_types": accepted_job_types,
                },
            )
        )
        result = self._next(self.claim_effects, "claim")
        assert result is None or isinstance(result, dict)
        return result

    def heartbeat(
        self, *, job_id: str, lease_token: str, progress: dict[str, object]
    ) -> dict[str, object]:
        self.calls.append(
            (
                "heartbeat",
                (),
                {
                    "job_id": job_id,
                    "lease_token": lease_token,
                    "progress": progress,
                },
            )
        )
        result = self._next(self.heartbeat_effects, "heartbeat")
        assert isinstance(result, dict)
        return result

    def complete(
        self,
        *,
        job_id: str,
        lease_token: str,
        result_hash: str,
        output_manifest: dict[str, object],
    ) -> dict[str, object]:
        self.calls.append(
            (
                "complete",
                (),
                {
                    "job_id": job_id,
                    "lease_token": lease_token,
                    "result_hash": result_hash,
                    "output_manifest": output_manifest,
                },
            )
        )
        result = self._next(self.complete_effects, "complete")
        assert isinstance(result, dict)
        return result

    def refresh_grants(
        self, *, job_id: str, lease_token: str
    ) -> dict[str, object]:
        self.calls.append(
            (
                "refresh_grants",
                (),
                {"job_id": job_id, "lease_token": lease_token},
            )
        )
        result = self._next(self.refresh_effects, "refresh_grants")
        assert isinstance(result, dict)
        return result

    def fail(
        self,
        *,
        job_id: str,
        lease_token: str,
        error: dict[str, object],
    ) -> dict[str, object]:
        self.calls.append(
            (
                "fail",
                (),
                {
                    "job_id": job_id,
                    "lease_token": lease_token,
                    "error": error,
                },
            )
        )
        result = self._next(self.fail_effects, "fail")
        assert isinstance(result, dict)
        return result

    def close(self) -> None:
        self.closed = True


def test_fake_executor_is_deterministic_for_same_job() -> None:
    executor = FakeExecutor()
    job = make_job()

    first = executor.run(job)
    second = executor.run(job)

    assert first.result_hash == second.result_hash
    assert first.output_manifest == second.output_manifest
    assert first.output_manifest["processorVersion"] == "0.1.0-fake"
    assert first.output_manifest["contractOnly"] is True
    assert "inputManifest" not in first.output_manifest
    assert first.output_manifest["inputManifestHash"] == sha256(
        canonical_json(job["inputManifest"]).encode("utf-8")
    ).hexdigest()


def test_fake_executor_manifest_omits_sensitive_input_material() -> None:
    executor = FakeExecutor()
    job = make_job()
    job["inputManifest"] = {
        "signedUrl": "https://signed.example/object?token=worker-secret-token",
        "credential": "lease-1",
    }

    result = executor.run(job)
    rendered = canonical_json(result.output_manifest)

    assert "signedUrl" not in rendered
    assert "worker-secret-token" not in rendered
    assert "lease-1" not in rendered
    assert result.output_manifest["objects"][0]["uploaded"] is False


def test_canonical_json_matches_shared_golden_vectors() -> None:
    fixture_path = Path(__file__).parent / "fixtures" / "canonical-json-vectors.json"
    vectors = json.loads(fixture_path.read_text(encoding="utf-8"))

    for vector in vectors:
        canonical = canonical_json(vector["input"])
        assert canonical == vector["canonical"]
        assert sha256(canonical.encode("utf-8")).hexdigest() == vector["sha256"]


def test_fake_executor_rejects_invalid_claim_shape() -> None:
    executor = FakeExecutor()
    broken_job = make_job()
    broken_job.pop("leaseToken")

    with pytest.raises(FakeExecutionError, match="INVALID_FAKE_JOB"):
        executor.run(broken_job)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("attemptNo", True),
        ("attemptNo", 4),
        ("jobId", "job-3001"),
        ("sessionId", "session-88"),
    ],
)
def test_fake_executor_rejects_invalid_attempt_and_identifier_shapes(
    field: str,
    value: object,
) -> None:
    executor = FakeExecutor()
    broken_job = make_job()
    broken_job[field] = value

    with pytest.raises(FakeExecutionError, match="INVALID_FAKE_JOB"):
        executor.run(broken_job)


def test_run_once_returns_idle_when_claim_is_empty() -> None:
    runner = WorkerRunner(
        config=make_config(),
        client=RecordingClient(claim_effects=[None]),
        executor=FakeExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "idle"


def test_run_once_stops_before_execute_on_first_heartbeat_lease_conflict() -> None:
    class TrackingExecutor:
        def __init__(self) -> None:
            self.called = False

        def run(self, job: dict[str, object]) -> FakeExecutorResult:
            self.called = True
            raise AssertionError("executor must not run after first heartbeat conflict")

    client = RecordingClient(
        claim_effects=[make_job()],
        heartbeat_effects=[
            InternalApiError("JOB_LEASE_CONFLICT", "Lease expired", False, 409)
        ],
    )
    executor = TrackingExecutor()
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=executor,
    )

    outcome = runner.run_once()

    assert outcome.kind == "lease_conflict"
    assert executor.called is False
    assert [call[0] for call in client.calls] == ["claim", "heartbeat"]


def test_run_once_success_sends_heartbeats_and_complete_in_order() -> None:
    client = RecordingClient(
        claim_effects=[make_job()],
        heartbeat_effects=[{"ok": True}, {"ok": True}],
        complete_effects=[{"ok": True}],
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=FakeExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "completed"
    assert [call[0] for call in client.calls] == [
        "claim",
        "heartbeat",
        "heartbeat",
        "complete",
    ]
    assert client.calls[1][2]["progress"] == {"phase": "claimed", "percent": 0}
    assert client.calls[2][2]["progress"] == {
        "phase": "ready_to_complete",
        "percent": 95,
    }


def test_run_once_allows_executor_reported_progress_heartbeats() -> None:
    class ProgressExecutor:
        def run(
            self,
            job: dict[str, object],
            *,
            report_progress=None,
        ) -> FakeExecutorResult:
            assert report_progress is not None
            report_progress({"phase": "downloading_source", "percent": 25})
            report_progress({"phase": "probing_media", "percent": 60})
            return FakeExecutor().run(job)

    client = RecordingClient(
        claim_effects=[make_job()],
        heartbeat_effects=[{"ok": True}, {"ok": True}, {"ok": True}, {"ok": True}],
        complete_effects=[{"ok": True}],
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=ProgressExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "completed"
    assert [call[0] for call in client.calls] == [
        "claim",
        "heartbeat",
        "heartbeat",
        "heartbeat",
        "heartbeat",
        "complete",
    ]
    assert client.calls[1][2]["progress"] == {"phase": "claimed", "percent": 0}
    assert client.calls[2][2]["progress"] == {"phase": "downloading_source", "percent": 25}
    assert client.calls[3][2]["progress"] == {"phase": "probing_media", "percent": 60}
    assert client.calls[4][2]["progress"] == {
        "phase": "ready_to_complete",
        "percent": 95,
    }


def test_run_once_passes_a_lease_bound_runtime_grant_refresh_callback() -> None:
    fresh_grants = {"resultManifestWrite": {"url": "https://signed.example/fresh"}}

    class RefreshingExecutor:
        def run(
            self,
            job: dict[str, object],
            *,
            refresh_runtime_grants=None,
        ) -> FakeExecutorResult:
            assert refresh_runtime_grants is not None
            assert refresh_runtime_grants() == fresh_grants
            return FakeExecutor().run(job)

    client = RecordingClient(
        claim_effects=[make_job()],
        heartbeat_effects=[{"ok": True}, {"ok": True}],
        refresh_effects=[fresh_grants],
        complete_effects=[{"ok": True}],
    )
    outcome = WorkerRunner(
        config=make_config(), client=client, executor=RefreshingExecutor()
    ).run_once()

    assert outcome.kind == "completed"
    refresh_call = next(call for call in client.calls if call[0] == "refresh_grants")
    assert refresh_call[2] == {"job_id": "3001", "lease_token": "lease-1"}


def test_run_once_stops_when_runtime_grant_refresh_loses_the_lease() -> None:
    class RefreshingExecutor:
        def run(
            self,
            job: dict[str, object],
            *,
            refresh_runtime_grants=None,
        ) -> FakeExecutorResult:
            assert refresh_runtime_grants is not None
            refresh_runtime_grants()
            raise AssertionError("unreachable")

    client = RecordingClient(
        claim_effects=[make_job()],
        heartbeat_effects=[{"ok": True}],
        refresh_effects=[
            InternalApiError("JOB_LEASE_CONFLICT", "Lease expired", False, 409)
        ],
    )
    outcome = WorkerRunner(
        config=make_config(), client=client, executor=RefreshingExecutor()
    ).run_once()

    assert outcome.kind == "lease_conflict"
    assert [call[0] for call in client.calls] == [
        "claim",
        "heartbeat",
        "refresh_grants",
    ]


def test_run_once_propagates_retryable_progress_api_errors_without_failing_the_job() -> None:
    class ProgressExecutor:
        def run(
            self,
            job: dict[str, object],
            *,
            report_progress=None,
        ) -> FakeExecutorResult:
            assert report_progress is not None
            report_progress({"phase": "downloading_source", "percent": 25})
            return FakeExecutor().run(job)

    client = RecordingClient(
        claim_effects=[make_job()],
        heartbeat_effects=[
            {"ok": True},
            InternalApiError("MULTIMODAL_UPLOAD_UNAVAILABLE", "secret-503", True, 503),
        ],
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=ProgressExecutor(),
    )

    with pytest.raises(InternalApiError) as error_info:
        runner.run_once()

    assert error_info.value.code == "MULTIMODAL_UPLOAD_UNAVAILABLE"
    assert [call[0] for call in client.calls] == ["claim", "heartbeat", "heartbeat"]


def test_run_once_reports_executor_failures_without_leaking_exception_text() -> None:
    class BrokenExecutor:
        def run(self, job: dict[str, object]) -> FakeExecutorResult:
            raise FakeExecutionError(
                "worker-secret-code",
                "do not leak worker-secret-token or lease-1",
            )

    client = RecordingClient(claim_effects=[make_job()], fail_effects=[{"ok": True}])
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=BrokenExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "failed"
    assert client.calls[-1][0] == "fail"
    assert client.calls[-1][2]["error"] == {
        "code": "FAKE_EXECUTOR_FAILED",
        "message": "Fake executor execution failed",
        "retryable": False,
    }


def test_run_once_logs_stable_failure_code_without_secret_leakage(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class BrokenExecutor:
        def run(self, job: dict[str, object]) -> FakeExecutorResult:
            raise FakeExecutionError(
                "worker-secret-code",
                "do not leak worker-secret-token or lease-1",
            )

    logger = logging.getLogger("educlaw.media_worker.test")
    client = RecordingClient(claim_effects=[make_job()], fail_effects=[{"ok": True}])
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=BrokenExecutor(),
        logger=logger,
    )

    with caplog.at_level(logging.ERROR, logger="educlaw.media_worker.test"):
        outcome = runner.run_once()

    assert outcome.kind == "failed"
    rendered_logs = "\n".join(record.getMessage() for record in caplog.records)
    assert "FAKE_EXECUTOR_FAILED" in rendered_logs
    assert "worker-secret-code" not in rendered_logs
    assert "worker-secret-token" not in rendered_logs
    assert "lease-1" not in rendered_logs


def test_run_once_uses_quality_check_error_payload_for_real_executor_failures() -> None:
    class BrokenExecutor:
        def run(
            self,
            job: dict[str, object],
            *,
            report_progress=None,
        ) -> FakeExecutorResult:
            raise QualityCheckExecutionError(
                "QUALITY_RESULT_MANIFEST_UPLOAD_FAILED",
                "Result manifest upload failed",
                retryable=True,
            )

    client = RecordingClient(claim_effects=[make_job()], fail_effects=[{"ok": True}])
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=BrokenExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "failed"
    assert client.calls[-1][2]["error"] == {
        "code": "QUALITY_RESULT_MANIFEST_UPLOAD_FAILED",
        "message": "Result manifest upload failed",
        "retryable": True,
    }


def test_run_once_drops_late_results_on_lease_conflict() -> None:
    client = RecordingClient(
        claim_effects=[make_job()],
        heartbeat_effects=[
            {"ok": True},
            InternalApiError("JOB_LEASE_CONFLICT", "Lease expired", False, 409),
        ],
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=FakeExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "lease_conflict"
    assert [call[0] for call in client.calls] == ["claim", "heartbeat", "heartbeat"]


def test_run_once_drops_late_complete_on_lease_conflict() -> None:
    client = RecordingClient(
        claim_effects=[make_job()],
        heartbeat_effects=[{"ok": True}, {"ok": True}],
        complete_effects=[
            InternalApiError("JOB_LEASE_CONFLICT", "Lease expired", False, 409)
        ],
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=FakeExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "lease_conflict"
    assert [call[0] for call in client.calls] == [
        "claim",
        "heartbeat",
        "heartbeat",
        "complete",
    ]


def test_run_once_records_non_retryable_completion_rejection_without_crashing() -> None:
    client = RecordingClient(
        claim_effects=[make_job()],
        heartbeat_effects=[{"ok": True}, {"ok": True}],
        complete_effects=[
            InternalApiError(
                "JOB_DATA_INTEGRITY_FAILED",
                "Internal media job request failed",
                False,
                422,
            )
        ],
        fail_effects=[{"ok": True}],
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=FakeExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "failed"
    assert outcome.code == "JOB_DATA_INTEGRITY_FAILED"
    assert [call[0] for call in client.calls] == [
        "claim",
        "heartbeat",
        "heartbeat",
        "complete",
        "fail",
    ]
    assert client.calls[-1][2]["error"] == {
        "code": "JOB_DATA_INTEGRITY_FAILED",
        "message": "Server rejected the completed job result",
        "retryable": False,
    }


def test_run_once_returns_lease_conflict_when_fail_conflicts() -> None:
    class BrokenExecutor:
        def run(self, job: dict[str, object]) -> FakeExecutorResult:
            raise FakeExecutionError("BROKEN_JOB", "internal failure")

    client = RecordingClient(
        claim_effects=[make_job()],
        fail_effects=[
            InternalApiError("JOB_LEASE_CONFLICT", "Lease expired", False, 409)
        ],
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=BrokenExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "lease_conflict"
    assert [call[0] for call in client.calls] == ["claim", "heartbeat", "fail"]


def test_run_forever_backs_off_on_idle_and_retryable_claim_errors() -> None:
    sleep_calls: list[float] = []
    stop_state = {"calls": 0}

    retryable_error = InternalApiError(
        "INTERNAL_MEDIA_JOB_REQUEST_FAILED",
        "request failed",
        True,
        None,
    )
    client = RecordingClient(claim_effects=[None, retryable_error, None])
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=FakeExecutor(),
        sleep=sleep_calls.append,
    )

    def stop_predicate() -> bool:
        stop_state["calls"] += 1
        return stop_state["calls"] > 3

    runner.run_forever(stop_predicate=stop_predicate)

    assert sleep_calls == [2.5, 5.0, 10.0]


def test_run_forever_resets_idle_backoff_after_claiming_work() -> None:
    sleep_calls: list[float] = []
    stop_state = {"calls": 0}
    client = RecordingClient(
        claim_effects=[None, make_job(), None],
        heartbeat_effects=[{"ok": True}, {"ok": True}],
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=FakeExecutor(),
        sleep=sleep_calls.append,
    )

    def stop_predicate() -> bool:
        stop_state["calls"] += 1
        return stop_state["calls"] > 3

    runner.run_forever(stop_predicate=stop_predicate)

    assert sleep_calls == [2.5, 2.5]


def test_run_forever_propagates_non_retryable_claim_errors_without_sleep() -> None:
    sleep_calls: list[float] = []
    client = RecordingClient(
        claim_effects=[
            InternalApiError(
                "JOB_LEASE_CONFLICT",
                "Internal media job request failed",
                False,
                409,
            )
        ]
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=FakeExecutor(),
        sleep=sleep_calls.append,
    )

    with pytest.raises(InternalApiError, match="Internal media job request failed"):
        runner.run_forever(stop_predicate=lambda: False)

    assert sleep_calls == []


def test_two_runners_have_no_shared_mutable_state() -> None:
    client_a = RecordingClient(claim_effects=[None])
    client_b = RecordingClient(claim_effects=[None])
    runner_a = WorkerRunner(config=make_config(), client=client_a, executor=FakeExecutor())
    runner_b = WorkerRunner(config=make_config(), client=client_b, executor=FakeExecutor())

    assert runner_a.run_once().kind == "idle"
    assert runner_b.run_once().kind == "idle"
    assert client_a.calls != []
    assert client_b.calls != []
    assert client_a.calls is not client_b.calls


def test_main_builds_and_closes_client(monkeypatch: pytest.MonkeyPatch) -> None:
    closed_client = RecordingClient(claim_effects=[None])
    registered_handlers: dict[int, object] = {}

    class StubRunner:
        def __init__(self, *, config, client, executor, sleep) -> None:
            self.config = config
            self.client = client
            self.executor = executor
            self.sleep = sleep
            assert config.executor_mode == EXECUTOR_MODE_CONTRACT_ONLY_FAKE
            assert isinstance(executor, FakeExecutor)

        def run_forever(self, *, stop_predicate) -> None:
            assert stop_predicate() is False
            registered_handlers[int(worker_main.signal.SIGTERM)](
                worker_main.signal.SIGTERM,
                None,
            )
            assert stop_predicate() is True

    monkeypatch.setenv("MEDIA_WORKER_BASE_URL", "http://node.test/api")
    monkeypatch.setenv("MEDIA_WORKER_SERVICE_TOKEN", "worker-secret-token")
    monkeypatch.setenv("MEDIA_WORKER_IDENTITY", "worker-a")
    monkeypatch.setenv("MEDIA_WORKER_REQUEST_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("MEDIA_WORKER_POLL_INTERVAL_SECONDS", "2")
    monkeypatch.setenv("MEDIA_WORKER_ACCEPTED_JOB_TYPES", "transcribe")
    monkeypatch.setenv(
        "MEDIA_WORKER_EXECUTOR_MODE",
        EXECUTOR_MODE_CONTRACT_ONLY_FAKE,
    )

    import media_worker.worker_main as worker_main

    logging.getLogger("httpx").setLevel(logging.NOTSET)
    logging.getLogger("httpcore").setLevel(logging.NOTSET)

    monkeypatch.setattr(worker_main, "InternalMediaJobClient", lambda **_: closed_client)
    monkeypatch.setattr(worker_main, "WorkerRunner", StubRunner)
    monkeypatch.setattr(
        worker_main.signal,
        "signal",
        lambda signum, handler: registered_handlers.__setitem__(int(signum), handler),
    )

    assert main([]) == 0
    assert closed_client.closed is True
    assert logging.getLogger("httpx").level >= logging.WARNING
    assert logging.getLogger("httpcore").level >= logging.WARNING


def test_two_workers_claim_independently_only_one_can_process_each_job() -> None:
    job = make_job()
    client_a = RecordingClient(
        claim_effects=[job],
        heartbeat_effects=[{"ok": True}, {"ok": True}],
        complete_effects=[{"ok": True}],
    )
    client_b = RecordingClient(claim_effects=[None])
    runner_a = WorkerRunner(
        config=make_config(),
        client=client_a,
        executor=FakeExecutor(),
    )
    runner_b = WorkerRunner(
        config=make_config(),
        client=client_b,
        executor=FakeExecutor(),
    )

    outcome_a = runner_a.run_once()
    outcome_b = runner_b.run_once()

    assert outcome_a.kind == "completed"
    assert outcome_b.kind == "idle"
    assert [call[0] for call in client_a.calls] == [
        "claim",
        "heartbeat",
        "heartbeat",
        "complete",
    ]
    assert [call[0] for call in client_b.calls] == ["claim"]


def test_worker_treats_empty_claim_as_idle_and_does_not_report_progress() -> None:
    client = RecordingClient(claim_effects=[None])
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=FakeExecutor(),
    )

    outcome = runner.run_once()

    assert outcome.kind == "idle"
    assert [call[0] for call in client.calls] == ["claim"]


def test_second_worker_can_claim_after_first_worker_leases_expire() -> None:
    job_a = make_job()
    job_a["jobId"] = "3001"
    job_a["sessionId"] = "88"
    job_b = make_job()
    job_b["jobId"] = "3001"
    job_b["sessionId"] = "88"
    job_b["leaseToken"] = "lease-2"

    client_a = RecordingClient(
        claim_effects=[job_a],
        heartbeat_effects=[{"ok": True}, {"ok": True}],
        complete_effects=[
            InternalApiError("JOB_LEASE_CONFLICT", "Lease expired", False, 409)
        ],
    )
    client_b = RecordingClient(
        claim_effects=[job_b],
        heartbeat_effects=[{"ok": True}, {"ok": True}],
        complete_effects=[{"ok": True}],
    )
    runner_a = WorkerRunner(
        config=make_config(),
        client=client_a,
        executor=FakeExecutor(),
    )
    runner_b = WorkerRunner(
        config=make_config(),
        client=client_b,
        executor=FakeExecutor(),
    )

    outcome_a = runner_a.run_once()
    outcome_b = runner_b.run_once()

    assert outcome_a.kind == "lease_conflict"
    assert outcome_b.kind == "completed"
    assert client_b.calls[-1][0] == "complete"
    assert client_b.calls[-1][2]["lease_token"] == "lease-2"


def test_worker_does_not_depend_on_previous_temp_directory() -> None:
    first_job = make_job()
    second_job = make_job()
    second_job["jobId"] = "3002"
    second_job["sessionId"] = "89"
    second_job["leaseToken"] = "lease-2"

    client = RecordingClient(
        claim_effects=[first_job, second_job],
        heartbeat_effects=[{"ok": True}, {"ok": True}, {"ok": True}, {"ok": True}],
        complete_effects=[{"ok": True}, {"ok": True}],
    )
    runner = WorkerRunner(
        config=make_config(),
        client=client,
        executor=FakeExecutor(),
    )

    outcome_first = runner.run_once()
    outcome_second = runner.run_once()

    assert outcome_first.kind == "completed"
    assert outcome_second.kind == "completed"
    assert client.calls[3][2]["output_manifest"]["sessionId"] == "88"
    assert client.calls[-1][2]["output_manifest"]["sessionId"] == "89"
