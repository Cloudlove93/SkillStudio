from __future__ import annotations


class WorkerConfigError(ValueError):
    """Raised when worker configuration is invalid."""


class InternalApiError(RuntimeError):
    """Stable wrapper for internal API failures."""

    def __init__(
        self,
        code: str,
        message: str,
        retryable: bool,
        status_code: int | None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status_code = status_code


class MediaAdapterError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.retryable = retryable


class FakeExecutionError(RuntimeError):
    """Raised when a claimed job cannot be executed by the fake executor."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


class QualityCheckExecutionError(RuntimeError):
    """Stable wrapper for media quality check execution failures."""

    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class DistillationExecutionError(RuntimeError):
    """Stable wrapper for prepare, transcription, and frame job failures."""

    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
