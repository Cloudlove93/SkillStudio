#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = Path(os.environ.get("ENV_FILE", ROOT / ".env"))


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def require_env(name: str, fallback: str = "") -> str:
    value = os.environ.get(name, fallback).strip()
    if not value:
        print(f"ERROR: {name} is empty. Set it in {ENV_FILE} or export {name}.", file=sys.stderr)
        sys.exit(2)
    return value


def stream_sse_lines(response):
    buffer = ""
    while True:
        chunk = response.read(1024)
        if not chunk:
            break
        buffer += chunk.decode("utf-8", errors="replace")
        parts = buffer.split("\n\n")
        buffer = parts.pop() or ""
        for part in parts:
            for line in part.splitlines():
                if line.startswith("data: "):
                    yield line[6:].strip()


def main() -> int:
    load_env_file(ENV_FILE)

    base_url = require_env("LLM_BASE_URL", "https://api.innospark.cn/v1").rstrip("/")
    api_key = require_env("LLM_API_KEY")
    model = os.environ.get("LLM_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
    prompt = os.environ.get("PROMPT", "只输出三百个汉字").strip()
    timeout = float(os.environ.get("TIMEOUT_SECONDS", "60"))
    max_tokens = int(os.environ.get("MAX_TOKENS", "16000"))

    body = {
        "model": model,
        "stream": True,
        "temperature": 0.1,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": "你是测试助手。回答必须按照字数要求。"},
            {"role": "user", "content": prompt},
        ],
    }

    url = f"{base_url}/chat/completions"
    request = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    print(f"POST {url}")
    print(f"model={model} stream=true")

    chunks: list[str] = []
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            content_type = response.headers.get("content-type", "")
            print(f"HTTP {response.status} content-type={content_type}")
            if "text/event-stream" not in content_type:
                raw = response.read().decode("utf-8", errors="replace")
                print("ERROR: response is not text/event-stream", file=sys.stderr)
                print(raw[:4000], file=sys.stderr)
                return 1

            for payload in stream_sse_lines(response):
                if not payload or payload == "[DONE]":
                    continue
                try:
                    data = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                delta = (((data.get("choices") or [{}])[0].get("delta") or {}).get("content"))
                if isinstance(delta, str) and delta:
                    chunks.append(delta)
                    print(f"chunk {delta}", flush=True)
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code}", file=sys.stderr)
        print(error.read().decode("utf-8", errors="replace")[:4000], file=sys.stderr)
        return 1
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    text = "".join(chunks).strip()
    if not text:
        print("ERROR: stream completed but produced no text", file=sys.stderr)
        return 1

    print("\nOK: stream returned content.")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
