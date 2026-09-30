from __future__ import annotations

import json

import pytest

from media_worker.errors import InternalApiError
from media_worker.internal_client import InternalMediaJobClient


def make_client() -> InternalMediaJobClient:
    return InternalMediaJobClient(
        base_url="http://node.test/api",
        service_token="worker-secret-token",
        timeout_seconds=5.0,
    )


def assert_single_request(httpx_mock, expected_payload: dict[str, object]) -> None:
    request = httpx_mock.get_requests()[0]
    assert request.method == "POST"
    assert str(request.url) == "http://node.test/api"
    assert request.headers["Authorization"] == "Bearer worker-secret-token"
    assert request.headers["Content-Type"] == "application/json"
    assert json.loads(request.content.decode("utf-8")) == expected_payload


def test_claim_posts_exact_internal_action(httpx_mock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={
            "success": True,
            "data": {
                "jobId": "3001",
                "sessionId": "88",
                "jobType": "transcribe",
                "attemptNo": 1,
                "maxAttempts": 3,
                "inputManifest": {"sourceObjectKey": "skill-sessions/88/source.wav"},
                "progress": {},
                "leaseToken": "lease-1",
                "leaseExpiresAt": "2026-08-21T00:01:00.000Z",
            },
        },
    )

    with make_client() as client:
        result = client.claim(
            worker_identity="worker-a",
            accepted_job_types=["transcribe", "media_quality_check"],
        )

    assert result is not None
    assert result["jobId"] == "3001"
    assert_single_request(
        httpx_mock,
        {
            "action": "internal.mediaJob.claim",
            "payload": {
                "workerIdentity": "worker-a",
                "acceptedJobTypes": ["transcribe", "media_quality_check"],
            },
        },
    )


def test_heartbeat_posts_exact_internal_action(httpx_mock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={"success": True, "data": {"ok": True}},
    )

    with make_client() as client:
        result = client.heartbeat(
            job_id="3001",
            lease_token="lease-1",
            progress={"phase": "claimed", "percent": 0},
        )

    assert result == {"ok": True}
    assert_single_request(
        httpx_mock,
        {
            "action": "internal.mediaJob.heartbeat",
            "payload": {
                "jobId": "3001",
                "leaseToken": "lease-1",
                "progress": {"phase": "claimed", "percent": 0},
            },
        },
    )


def test_refresh_grants_posts_exact_internal_action(httpx_mock) -> None:
    grants = {
        "artifactWrites": {
            "transcript": {
                "method": "PUT",
                "objectKey": "skill-sessions/21/jobs/17/attempt-2/transcript.json",
                "url": "https://signed.example/fresh",
                "expiresAt": "2026-08-21T00:06:00.000Z",
                "headers": {"content-type": "application/json"},
            }
        }
    }
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={"success": True, "data": grants},
    )

    with make_client() as client:
        result = client.refresh_grants(job_id="17", lease_token="lease-token")

    assert result == grants
    assert_single_request(
        httpx_mock,
        {
            "action": "internal.mediaJob.refreshGrants",
            "payload": {"jobId": "17", "leaseToken": "lease-token"},
        },
    )


def test_complete_posts_exact_internal_action(httpx_mock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={"success": True, "data": {"ok": True}},
    )

    with make_client() as client:
        result = client.complete(
            job_id="3001",
            lease_token="lease-1",
            result_hash="a" * 64,
            output_manifest={"processorVersion": "fake-worker-v1"},
        )

    assert result == {"ok": True}
    assert_single_request(
        httpx_mock,
        {
            "action": "internal.mediaJob.complete",
            "payload": {
                "jobId": "3001",
                "leaseToken": "lease-1",
                "resultHash": "a" * 64,
                "outputManifest": {"processorVersion": "fake-worker-v1"},
            },
        },
    )


def test_fail_posts_exact_internal_action(httpx_mock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={"success": True, "data": {"ok": True}},
    )

    with make_client() as client:
        result = client.fail(
            job_id="3001",
            lease_token="lease-1",
            error={
                "code": "FAKE_EXECUTOR_FAILED",
                "message": "Fake executor execution failed",
                "retryable": False,
            },
        )

    assert result == {"ok": True}
    assert_single_request(
        httpx_mock,
        {
            "action": "internal.mediaJob.fail",
            "payload": {
                "jobId": "3001",
                "leaseToken": "lease-1",
                "error": {
                    "code": "FAKE_EXECUTOR_FAILED",
                    "message": "Fake executor execution failed",
                    "retryable": False,
                },
            },
        },
    )


def test_claim_allows_empty_result(httpx_mock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={"success": True, "data": None},
    )

    with make_client() as client:
        assert (
            client.claim(worker_identity="worker-a", accepted_job_types=["transcribe"])
            is None
        )


def test_raises_stable_error_for_json_api_failures(httpx_mock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        status_code=409,
        json={
            "code": "JOB_LEASE_CONFLICT",
            "message": "worker-secret-token lease-1 must not leak",
            "retryable": False,
        },
    )

    with make_client() as client:
        with pytest.raises(InternalApiError) as error_info:
            client.complete(
                job_id="3001",
                lease_token="lease-1",
                result_hash="a" * 64,
                output_manifest={},
            )

    error = error_info.value
    assert error.code == "JOB_LEASE_CONFLICT"
    assert error.retryable is False
    assert error.status_code == 409
    assert str(error) == "Internal media job request failed"
    assert "worker-secret-token" not in str(error)
    assert "lease-1" not in str(error)
    assert "worker-secret-token" not in repr(error)
    assert "lease-1" not in repr(error)
    assert error.args == ("Internal media job request failed",)


def test_raises_stable_error_for_unsuccessful_json_envelope_without_secret_leakage(
    httpx_mock,
) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={
            "success": False,
            "code": "JOB_LEASE_CONFLICT",
            "message": "worker-secret-token lease-1 must not leak",
            "retryable": False,
        },
    )

    with make_client() as client:
        with pytest.raises(InternalApiError) as error_info:
            client.claim(worker_identity="worker-a", accepted_job_types=["transcribe"])

    error = error_info.value
    assert error.code == "JOB_LEASE_CONFLICT"
    assert error.retryable is False
    assert "worker-secret-token" not in str(error)
    assert "lease-1" not in str(error)


def test_raises_stable_error_for_non_json_responses_without_secret_leakage(
    httpx_mock,
) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        status_code=502,
        text="worker-secret-token lease-1 raw-body",
    )

    with make_client() as client:
        with pytest.raises(InternalApiError) as error_info:
            client.fail(
                job_id="3001",
                lease_token="lease-1",
                error={
                    "code": "FAKE_EXECUTOR_FAILED",
                    "message": "Fake executor execution failed",
                    "retryable": False,
                },
            )

    error = error_info.value
    assert error.status_code == 502
    assert "worker-secret-token" not in str(error)
    assert "lease-1" not in str(error)
    assert "raw-body" not in str(error)


def test_rejects_invalid_success_envelope_and_bad_data_shapes(httpx_mock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={"success": False, "code": "BAD_ENVELOPE", "message": "bad", "retryable": True},
    )
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={"success": True, "data": ["not", "an", "object"]},
    )
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        text='{"success": true, "data": ',
        status_code=200,
    )

    with make_client() as client:
        with pytest.raises(InternalApiError) as first_error:
            client.claim(worker_identity="worker-a", accepted_job_types=["transcribe"])
        with pytest.raises(InternalApiError) as second_error:
            client.heartbeat(
                job_id="3001",
                lease_token="lease-1",
                progress={"phase": "claimed", "percent": 0},
            )
        with pytest.raises(InternalApiError) as third_error:
            client.fail(
                job_id="3001",
                lease_token="lease-1",
                error={
                    "code": "FAKE_EXECUTOR_FAILED",
                    "message": "Fake executor execution failed",
                    "retryable": False,
                },
            )

    assert first_error.value.code == "BAD_ENVELOPE"
    assert second_error.value.code == "INTERNAL_MEDIA_JOB_RESPONSE_INVALID"
    assert third_error.value.code == "INTERNAL_MEDIA_JOB_RESPONSE_INVALID"


def test_client_close_and_context_manager_close_httpx_client(httpx_mock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://node.test/api",
        json={"success": True, "data": None},
    )

    client = make_client()
    assert client._client.is_closed is False
    client.close()
    assert client._client.is_closed is True

    with make_client() as managed_client:
        managed_client.claim(worker_identity="worker-a", accepted_job_types=["transcribe"])

    assert managed_client._client.is_closed is True
