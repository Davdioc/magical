import json
import os
from typing import AsyncIterator

import httpx

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


class OpenRouterError(RuntimeError):
    pass


async def stream_chat(
    messages: list[dict],
    *,
    system: str,
    model: str | None = None,
    api_key: str | None = None,
) -> AsyncIterator[str]:
    """Stream assistant text deltas from OpenRouter's OpenAI-compatible endpoint.

    Yields content chunks as they arrive. Raises OpenRouterError on non-2xx or
    missing credentials.
    """
    key = api_key or os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise OpenRouterError("OPENROUTER_API_KEY not set")

    model_id = model or os.environ.get("OPENROUTER_MODEL", "moonshotai/kimi-k2.6")

    payload = {
        "model": model_id,
        "stream": True,
        "messages": [{"role": "system", "content": system}, *messages],
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Magical Automation Designer",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
        async with client.stream("POST", OPENROUTER_URL, json=payload, headers=headers) as response:
            if response.status_code >= 400:
                body = await response.aread()
                raise OpenRouterError(
                    f"OpenRouter returned {response.status_code}: {body.decode('utf-8', errors='replace')}"
                )

            async for raw_line in response.aiter_lines():
                line = raw_line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    return
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue

                choices = event.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                chunk = delta.get("content")
                if chunk:
                    yield chunk
