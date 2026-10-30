export interface GenerationFailureDiagnostic {
  reason:
    | 'authentication'
    | 'model_configuration'
    | 'rate_limit'
    | 'provider_unavailable'
    | 'transport'
    | 'truncated'
    | 'json_syntax'
    | 'time_bounds'
    | 'empty_result'
    | 'schema'
    | 'unknown';
  retryable: boolean;
  status?: number;
  path?: string;
}

/** Never return raw messages, model output, source text, URLs or credentials. */
export function classifyGenerationFailure(
  error: unknown,
): GenerationFailureDiagnostic {
  if (
    error &&
    typeof error === 'object' &&
    'contractPath' in error &&
    typeof error.contractPath === 'string'
  ) {
    return {
      reason:
        'contractReason' in error && error.contractReason === 'time_bounds'
          ? 'time_bounds'
          : 'schema',
      retryable: false,
      path: error.contractPath.slice(0, 160),
    };
  }
  if (
    error &&
    typeof error === 'object' &&
    'diagnostic' in error &&
    (error as { diagnostic?: GenerationFailureDiagnostic }).diagnostic
  )
    return (error as { diagnostic: GenerationFailureDiagnostic }).diagnostic;
  const text = error instanceof Error ? `${error.name}: ${error.message}` : '';
  const status =
    Number(text.match(/(?:request failed:|HTTP)\s*(\d{3})/i)?.[1]) || undefined;
  const path = text
    .match(
      /\b((?:moments|semanticMomentModelResult|transcript|primarySource|visualContext)(?:\[\d+\]|\.[A-Za-z][A-Za-z0-9]*)*)\b/,
    )?.[1]
    ?.slice(0, 160);
  let reason: GenerationFailureDiagnostic['reason'] = 'unknown';
  let retryable = true;
  if (
    status === 401 ||
    status === 403 ||
    /API_KEY is not configured/.test(text)
  ) {
    reason = 'authentication';
    retryable = false;
  } else if (status === 400 || status === 404 || status === 422) {
    reason = 'model_configuration';
    retryable = false;
  } else if (status === 429) reason = 'rate_limit';
  else if (status && status >= 500) reason = 'provider_unavailable';
  else if (/Truncated|token limit|finish_reason.*length/i.test(text)) {
    reason = 'truncated';
    retryable = false;
  } else if (/InvalidJson|invalid JSON|JSON syntax|SyntaxError/i.test(text))
    reason = 'json_syntax';
  else if (/OUT_OF_WINDOW|out of range|timeRange|overlap/i.test(text)) {
    reason = 'time_bounds';
    retryable = false;
  } else if (/CHUNK_RESULT_INVALID|empty result/i.test(text))
    reason = 'empty_result';
  else if (/network|timed out|AbortError|fetch failed/i.test(text))
    reason = 'transport';
  else if (path || /unknown fields|must be|invalid|contract/i.test(text)) {
    reason = 'schema';
    retryable = false;
  }
  return {
    reason,
    retryable,
    ...(status ? { status } : {}),
    ...(path ? { path } : {}),
  };
}
