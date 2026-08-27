from __future__ import annotations

from typing import Any

import httpx

from .errors import InternalApiError


def _is_object(value: Any) -> bool:
    return isinstance(value, dict)


class InternalMediaJobClient:
    def __init__(
        self,
        *,
        base_url: str,
        service_token: str,
        timeout_seconds: float,
    ) -> None:
        self._base_url = base_url
        self._client = httpx.Client(
            timeout=timeout_seconds,
            headers={
                "Authorization": f"Bearer {service_token}",
                "Content-Type": "application/json",
            },
        )

    def __enter__(self) -> "InternalMediaJobClient":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _invalid_response(self, message: str, status_code: int) -> InternalApiError:
        return InternalApiError(
            "INTERNAL_MEDIA_JOB_RESPONSE_INVALID",
            message,
            False,
            status_code,
        )

    def _error_from_response(self, response: httpx.Response) -> InternalApiError:
        try:
            body = response.json()
        except ValueError:
            return InternalApiError(
                "INTERNAL_MEDIA_JOB_ERROR",
                "Internal media job request failed",
                False,
                response.status_code,
            )

        if _is_object(body):
            code = body.get("code")
            retryable = body.get("retryable", False)
            if isinstance(code, str) and isinstance(retryable, bool):
                return InternalApiError(
                    code,
                    "Internal media job request failed",
                    retryable,
                    response.status_code,
                )
        return InternalApiError(
            "INTERNAL_MEDIA_JOB_ERROR",
            "Internal media job request failed",
            False,
            response.status_code,
        )

    def _post(
        self,
        *,
        action: str,
        payload: dict[str, object],
        allow_null_data: bool,
    ) -> dict[str, object] | None:
        try:
            response = self._client.post(
                self._base_url,
                json={"action": action, "payload": payload},
            )
        except httpx.HTTPError as error:
            raise InternalApiError(
                "INTERNAL_MEDIA_JOB_REQUEST_FAILED",
                "Internal media job request failed",
                True,
                None,
            ) from error

        if response.status_code < 200 or response.status_code >= 300:
            raise self._error_from_response(response)

        try:
            body = response.json()
        except ValueError as error:
            raise self._invalid_response(
                "Internal media job response was not valid JSON",
                response.status_code,
            ) from error

        if not _is_object(body):
            raise self._invalid_response(
                "Internal media job response envelope was invalid",
                response.status_code,
            )

        if body.get("success") is not True:
            code = body.get("code")
            retryable = body.get("retryable", False)
            if isinstance(code, str) and isinstance(retryable, bool):
                raise InternalApiError(
                    code,
                    "Internal media job request failed",
                    retryable,
                    response.status_code,
                )
            raise self._invalid_response(
                "Internal media job response envelope was invalid",
                response.status_code,
            )

        data = body.get("data")
        if data is None and allow_null_data:
            return None
        if not _is_object(data):
            raise self._invalid_response(
                "Internal media job response data was invalid",
                response.status_code,
            )
        return data

    def claim(
        self,
        *,
        worker_identity: str,
        accepted_job_types: list[str],
    ) -> dict[str, object] | None:
        return self._post(
            action="internal.mediaJob.claim",
            payload={
                "workerIdentity": worker_identity,
                "acceptedJobTypes": accepted_job_types,
            },
            allow_null_data=True,
        )

    def heartbeat(
        self,
        *,
        job_id: str,
        lease_token: str,
        progress: dict[str, object],
    ) -> dict[str, object]:
        result = self._post(
            action="internal.mediaJob.heartbeat",
            payload={
                "jobId": job_id,
                "leaseToken": lease_token,
                "progress": progress,
            },
            allow_null_data=False,
        )
        assert result is not None
        return result

    def refresh_grants(
        self,
        *,
        job_id: str,
        lease_token: str,
    ) -> dict[str, object]:
        result = self._post(
            action="internal.mediaJob.refreshGrants",
            payload={"jobId": job_id, "leaseToken": lease_token},
            allow_null_data=False,
        )
        assert result is not None
        return result

    def complete(
        self,
        *,
        job_id: str,
        lease_token: str,
        result_hash: str,
        output_manifest: dict[str, object],
    ) -> dict[str, object]:
        result = self._post(
            action="internal.mediaJob.complete",
            payload={
                "jobId": job_id,
                "leaseToken": lease_token,
                "resultHash": result_hash,
                "outputManifest": output_manifest,
            },
            allow_null_data=False,
        )
        assert result is not None
        return result

    def fail(
        self,
        *,
        job_id: str,
        lease_token: str,
        error: dict[str, object],
    ) -> dict[str, object]:
        result = self._post(
            action="internal.mediaJob.fail",
            payload={
                "jobId": job_id,
                "leaseToken": lease_token,
                "error": error,
            },
            allow_null_data=False,
        )
        assert result is not None
        return result
