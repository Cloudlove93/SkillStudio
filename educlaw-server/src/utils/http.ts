export function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export function buildInternalErrorPayload(requestId?: string) {
  return {
    code: "INTERNAL_REQUEST_FAILED",
    message: "服务端处理失败，请稍后重试",
    retryable: true,
    ...(requestId ? { requestId } : {}),
  };
}
