from __future__ import annotations

import logging
import os
import inspect
import signal
import time
from dataclasses import dataclass
from typing import Callable, Protocol

from .config import (
    EXECUTOR_MODE_CONTRACT_ONLY_FAKE,
    EXECUTOR_MODE_DISTILLATION,
    EXECUTOR_MODE_MEDIA_QUALITY_CHECK,
    WorkerConfig,
)
from .asr_adapter import AsrBackendConfig
from .errors import (
    DistillationExecutionError,
    InternalApiError,
    QualityCheckExecutionError,
    WorkerConfigError,
)
from .fake_executor import FakeExecutor, FakeExecutorResult, parse_claimed_job
from .distillation_executor import DistillationExecutor
from .internal_client import InternalMediaJobClient
from .quality_check_executor import QualityCheckExecutor


class ClientProtocol(Protocol):
    def claim(
        self, *, worker_identity: str, accepted_job_types: list[str]
    ) -> dict[str, object] | None:
        ...

    def heartbeat(
        self, *, job_id: str, lease_token: str, progress: dict[str, object]
    ) -> dict[str, object]:
        ...

    def refresh_grants(
        self, *, job_id: str, lease_token: str
    ) -> dict[str, object]:
        ...

    def complete(
        self,
        *,
        job_id: str,
        lease_token: str,
        result_hash: str,
        output_manifest: dict[str, object],
    ) -> dict[str, object]:
        ...

    def fail(
        self, *, job_id: str, lease_token: str, error: dict[str, object]
    ) -> dict[str, object]:
        ...

    def close(self) -> None:
        ...


class ExecutorProtocol(Protocol):
    def run(
        self,
        job: dict[str, object],
        *,
        report_progress: Callable[[dict[str, object]], None] | None = None,
        refresh_runtime_grants: Callable[[], dict[str, object]] | None = None,
    ) -> FakeExecutorResult:
        ...


@dataclass(frozen=True)
class RunOnceOutcome:
    kind: str
    job_id: str | None = None
    code: str | None = None


def _is_lease_conflict(error: InternalApiError) -> bool:
    return error.code == "JOB_LEASE_CONFLICT"


class WorkerRunner:
    def __init__(
        self,
        *,
        config: WorkerConfig,
        client: ClientProtocol,
        executor: ExecutorProtocol,
        sleep: Callable[[float], None] = time.sleep,
        logger: logging.Logger | None = None,
    ) -> None:
        self._config = config
        self._client = client
        self._executor = executor
        self._sleep = sleep
        self._logger = logger or logging.getLogger("educlaw.media_worker")

    def run_once(self) -> RunOnceOutcome:
        claimed_job_data = self._client.claim(
            worker_identity=self._config.worker_identity,
            accepted_job_types=list(self._config.accepted_job_types),
        )
        if claimed_job_data is None:
            return RunOnceOutcome(kind="idle")

        claimed_job = parse_claimed_job(claimed_job_data)

        try:
            self._client.heartbeat(
                job_id=claimed_job.job_id,
                lease_token=claimed_job.lease_token,
                progress={"phase": "claimed", "percent": 0},
            )
        except InternalApiError as error:
            if _is_lease_conflict(error):
                return RunOnceOutcome(
                    kind="lease_conflict",
                    job_id=claimed_job.job_id,
                    code=error.code,
                )
            raise

        try:
            run_signature = inspect.signature(self._executor.run)
            run_kwargs: dict[str, object] = {}
            if "report_progress" in run_signature.parameters:
                run_kwargs["report_progress"] = lambda progress: self._client.heartbeat(
                        job_id=claimed_job.job_id,
                        lease_token=claimed_job.lease_token,
                        progress=progress,
                    )
            if "refresh_runtime_grants" in run_signature.parameters:
                run_kwargs["refresh_runtime_grants"] = lambda: self._client.refresh_grants(
                    job_id=claimed_job.job_id,
                    lease_token=claimed_job.lease_token,
                )
            result = self._executor.run(claimed_job_data, **run_kwargs)
        except InternalApiError as error:
            if _is_lease_conflict(error):
                return RunOnceOutcome(
                    kind="lease_conflict",
                    job_id=claimed_job.job_id,
                    code=error.code,
                )
            raise
        except Exception as error:
            return self._handle_executor_failure(claimed_job.job_id, claimed_job.lease_token, error)

        try:
            self._client.heartbeat(
                job_id=claimed_job.job_id,
                lease_token=claimed_job.lease_token,
                progress={"phase": "ready_to_complete", "percent": 95},
            )
        except InternalApiError as error:
            if _is_lease_conflict(error):
                return RunOnceOutcome(
                    kind="lease_conflict",
                    job_id=claimed_job.job_id,
                    code=error.code,
                )
            raise

        try:
            self._client.complete(
                job_id=claimed_job.job_id,
                lease_token=claimed_job.lease_token,
                result_hash=result.result_hash,
                output_manifest=result.output_manifest,
            )
        except InternalApiError as error:
            if _is_lease_conflict(error):
                return RunOnceOutcome(
                    kind="lease_conflict",
                    job_id=claimed_job.job_id,
                    code=error.code,
                )
            if error.retryable:
                raise
            self._logger.error(
                "worker completion rejected worker=%s job_id=%s code=%s status=%s",
                self._config.worker_identity,
                claimed_job.job_id,
                error.code,
                error.status_code,
            )
            try:
                self._client.fail(
                    job_id=claimed_job.job_id,
                    lease_token=claimed_job.lease_token,
                    error={
                        "code": error.code,
                        "message": "Server rejected the completed job result",
                        "retryable": False,
                    },
                )
            except InternalApiError as fail_error:
                if _is_lease_conflict(fail_error):
                    return RunOnceOutcome(
                        kind="lease_conflict",
                        job_id=claimed_job.job_id,
                        code=fail_error.code,
                    )
                raise
            return RunOnceOutcome(
                kind="failed",
                job_id=claimed_job.job_id,
                code=error.code,
            )

        self._logger.info(
            "completed job worker=%s job_id=%s",
            self._config.worker_identity,
            claimed_job.job_id,
        )
        return RunOnceOutcome(kind="completed", job_id=claimed_job.job_id)

    def _handle_executor_failure(
        self, job_id: str, lease_token: str, error: Exception
    ) -> RunOnceOutcome:
        error_code = "FAKE_EXECUTOR_FAILED"
        error_message = "Fake executor execution failed"
        retryable = False
        if isinstance(error, QualityCheckExecutionError):
            error_code = error.code
            error_message = str(error)
            retryable = error.retryable
        elif isinstance(error, DistillationExecutionError):
            error_code = error.code
            error_message = str(error)
            retryable = error.retryable
        self._logger.error(
            "worker executor failed worker=%s job_id=%s code=%s",
            self._config.worker_identity,
            job_id,
            error_code,
        )
        try:
            self._client.fail(
                job_id=job_id,
                lease_token=lease_token,
                error={
                    "code": error_code,
                    "message": error_message,
                    "retryable": retryable,
                },
            )
        except InternalApiError as api_error:
            if _is_lease_conflict(api_error):
                return RunOnceOutcome(
                    kind="lease_conflict",
                    job_id=job_id,
                    code=api_error.code,
                )
            raise
        return RunOnceOutcome(kind="failed", job_id=job_id, code=error_code)

    def run_forever(self, *, stop_predicate: Callable[[], bool]) -> None:
        idle_delay = self._config.poll_interval_seconds
        while not stop_predicate():
            try:
                outcome = self.run_once()
            except InternalApiError as error:
                if error.retryable:
                    self._sleep(idle_delay)
                    idle_delay = min(
                        idle_delay * 2,
                        self._config.max_idle_poll_interval_seconds,
                    )
                    continue
                raise

            if outcome.kind == "idle":
                self._sleep(idle_delay)
                idle_delay = min(
                    idle_delay * 2,
                    self._config.max_idle_poll_interval_seconds,
                )
            else:
                idle_delay = self._config.poll_interval_seconds


def main(argv: list[str] | None = None) -> int:
    _ = argv or []
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logger = logging.getLogger("educlaw.media_worker")
    config = WorkerConfig.from_env(os.environ)
    if config.executor_mode == EXECUTOR_MODE_CONTRACT_ONLY_FAKE:
        executor = FakeExecutor()
    elif config.executor_mode == EXECUTOR_MODE_MEDIA_QUALITY_CHECK:
        executor = QualityCheckExecutor(
            max_duration_ms=config.max_media_duration_ms,
            heartbeat_interval_seconds=config.heartbeat_interval_seconds,
        )
    elif config.executor_mode == EXECUTOR_MODE_DISTILLATION:
        executor = DistillationExecutor(
            max_duration_ms=config.max_media_duration_ms,
            heartbeat_interval_seconds=config.heartbeat_interval_seconds,
            asr_backend_config=AsrBackendConfig(
                model_name_or_path=config.asr_model_name_or_path,
                manifest_model_id=config.asr_manifest_model_id,
                device=config.asr_device,
                compute_type=config.asr_compute_type,
                language=config.asr_language,
                beam_size=config.asr_beam_size,
                vad_filter=True,
                condition_on_previous_text=False,
            ),
        )
    else:
        raise WorkerConfigError(
            "MEDIA_WORKER_EXECUTOR_MODE must equal contract_only_fake, media_quality_check, or distillation"
        )
    client = InternalMediaJobClient(
        base_url=config.base_url,
        service_token=config.service_token,
        timeout_seconds=config.request_timeout_seconds,
    )
    logger.info(
        "starting media worker worker=%s mode=%s",
        config.worker_identity,
        config.executor_mode,
    )
    runner = WorkerRunner(
        config=config,
        client=client,
        executor=executor,
        sleep=time.sleep,
    )

    stop_requested = {"value": False}

    def request_stop(signum, _frame) -> None:
        logger.info(
            "stop requested worker=%s signal=%s",
            config.worker_identity,
            signum,
        )
        stop_requested["value"] = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    try:
        runner.run_forever(stop_predicate=lambda: stop_requested["value"])
        return 0
    finally:
        client.close()
