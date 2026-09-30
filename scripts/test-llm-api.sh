#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"
PROMPT="${PROMPT:-Reply with exactly: EduClaw API OK}"
TIMEOUT_MS="${TIMEOUT_MS:-30000}"
MAX_TOKENS="${MAX_TOKENS:-512}"
STREAM="${STREAM:-false}"

read_env_value() {
  local key="$1"
  local fallback="${2:-}"
  local value=""

  if [[ -f "$ENV_FILE" ]]; then
    value="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    value="${value%$'\r'}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
  fi

  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

mask_key() {
  local key="$1"
  local length="${#key}"
  if [[ "$length" -le 8 ]]; then
    printf '***'
  else
    printf '%s...%s' "${key:0:4}" "${key: -4}"
  fi
}

LLM_BASE_URL="${LLM_BASE_URL:-$(read_env_value LLM_BASE_URL "")}"
LLM_API_KEY="${LLM_API_KEY:-$(read_env_value LLM_API_KEY "")}"
LLM_MODEL="${LLM_MODEL:-$(read_env_value LLM_MODEL "")}"

if [[ -z "$LLM_BASE_URL" ]]; then
  echo "ERROR: LLM_BASE_URL is empty. Set it in $ENV_FILE or export LLM_BASE_URL." >&2
  exit 2
fi

if [[ -z "$LLM_API_KEY" || "$LLM_API_KEY" == "your-llm-api-key" ]]; then
  echo "ERROR: LLM_API_KEY is empty or still a placeholder. Set it in $ENV_FILE or export LLM_API_KEY." >&2
  exit 2
fi

if [[ -z "$LLM_MODEL" ]]; then
  echo "ERROR: LLM_MODEL is empty. Set it in $ENV_FILE or export LLM_MODEL." >&2
  exit 2
fi

export LLM_BASE_URL LLM_API_KEY LLM_MODEL PROMPT TIMEOUT_MS MAX_TOKENS
export STREAM

echo "Testing LLM API"
echo "  env:     $ENV_FILE"
echo "  base:    $LLM_BASE_URL"
echo "  model:   $LLM_MODEL"
echo "  key:     $(mask_key "$LLM_API_KEY")"
echo "  timeout: ${TIMEOUT_MS}ms"
echo "  stream:  $STREAM"
echo

node <<'NODE'
const baseUrl = String(process.env.LLM_BASE_URL || "").replace(/\/+$/, "");
const model = String(process.env.LLM_MODEL || "");
const apiKey = String(process.env.LLM_API_KEY || "");
const prompt = String(process.env.PROMPT || "Reply with exactly: EduClaw API OK");
const timeoutMs = Number(process.env.TIMEOUT_MS || 30000);
const maxTokens = Number(process.env.MAX_TOKENS || 64);
const stream = /^(1|true|yes|on)$/i.test(String(process.env.STREAM || "false"));

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

const body = {
  model,
  messages: [{ role: "user", content: prompt }],
  stream,
  max_tokens: Number.isFinite(maxTokens) ? maxTokens : 64,
};

if (model.toLowerCase() === "kimi-k2.6") {
  body.thinking = { type: "disabled" };
} else if (model.toLowerCase() === "kimi-k2.5") {
  body.temperature = 1;
} else {
  body.temperature = 0.2;
}

function hintForStatus(status, text) {
  if (status === 401 || status === 403) return "Authentication failed: check LLM_API_KEY and account permissions.";
  if (status === 404) return "Endpoint or model not found: check LLM_BASE_URL and LLM_MODEL.";
  if (status === 429) return "Rate limit or quota issue: check provider quota and billing.";
  if (status >= 500) return "Provider/server error: retry later or check provider status.";
  if (/model/i.test(text) && /not|unknown|invalid|不存在/.test(text)) return "Model may be invalid for this provider.";
  return "";
}

try {
  const url = `${baseUrl}/chat/completions`;
  console.log(`POST ${url}`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timer);

  console.log(`HTTP ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const text = await response.text();
    console.error("\nRequest failed.");
    const hint = hintForStatus(response.status, text);
    if (hint) console.error(`Hint: ${hint}`);
    console.error("\nResponse body:");
    console.error(text.slice(0, 4000));
    process.exit(1);
  }

  if (stream && response.headers.get("content-type")?.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === "string") content += delta;
          } catch {
            // ignore malformed diagnostic chunks
          }
        }
      }
    }
    if (!content) {
      console.error("\nStream completed but produced no content.");
      process.exit(1);
    }
    console.log("\nOK: stream returned content.");
    console.log("\nContent:");
    console.log(content.trim());
    process.exit(0);
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    console.error("\nResponse is not valid JSON.");
    console.error(text.slice(0, 4000));
    process.exit(1);
  }

  const choice = json.choices?.[0];
  const content = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason ?? "";

  if (!content) {
    console.error("\nResponse JSON did not contain choices[0].message.content.");
    console.error(JSON.stringify(json, null, 2).slice(0, 4000));
    process.exit(1);
  }

  console.log("\nOK: model returned content.");
  if (finishReason) console.log(`finish_reason: ${finishReason}`);
  if (json.usage) console.log(`usage: ${JSON.stringify(json.usage)}`);
  console.log("\nContent:");
  console.log(content.trim());
} catch (error) {
  clearTimeout(timer);
  if (error?.name === "AbortError") {
    console.error(`ERROR: request timed out after ${timeoutMs}ms.`);
  } else {
    console.error(`ERROR: ${error?.message || String(error)}`);
  }
  process.exit(1);
}
NODE
