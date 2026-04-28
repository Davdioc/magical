import json
import logging
import re
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from openrouter import OpenRouterError, stream_chat
from prompt import build_system_prompt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_PROMPT = build_system_prompt()


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


def _sse(event_type: str, content) -> bytes:
    payload = json.dumps({"type": event_type, "content": content})
    return f"data: {payload}\n\n".encode("utf-8")


def _extract_clarify(text: str) -> list[dict] | None:
    match = re.search(r"<clarify>([\s\S]*?)</clarify>", text)
    if not match:
        return None
    try:
        data = json.loads(match.group(1).strip())
        questions = data.get("questions")
        if isinstance(questions, list) and questions:
            out = []
            for item in questions:
                q = item.get("q", "")
                options = item.get("options", [])
                if q and isinstance(options, list) and options:
                    out.append({"q": str(q), "options": [str(o) for o in options]})
            return out if out else None
    except (json.JSONDecodeError, AttributeError):
        pass
    return None


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/chat")
async def chat(request: ChatRequest):
    async def event_stream():
        full_response = []
        clarify_emitted = False
        automation_emitted = False
        try:
            async for chunk in stream_chat(
                [m.model_dump() for m in request.messages],
                system=SYSTEM_PROMPT,
            ):
                full_response.append(chunk)
                yield _sse("text", chunk)

                text_so_far = "".join(full_response)

                if not clarify_emitted and "</clarify>" in text_so_far:
                    options = _extract_clarify(text_so_far)
                    if options:
                        clarify_emitted = True
                        yield _sse("clarify", options)

                if not automation_emitted and "</automation>" in text_so_far:
                    automation_emitted = True
                    yield _sse("automation_ready", None)

        except OpenRouterError as exc:
            logging.error("OpenRouter error: %s", exc)
            yield _sse("error", str(exc))
        except Exception as exc:  # noqa: BLE001
            logging.error("Unexpected error: %s", exc)
            yield _sse("error", f"Unexpected error: {exc}")
        finally:
            text = "".join(full_response)
            has_automation = "<automation>" in text
            has_clarify = "<clarify>" in text
            logging.info(
                "Response complete | %d chars | automation: %s | clarify: %s",
                len(text),
                "YES" if has_automation else "NO",
                "YES" if has_clarify else "NO",
            )
            if not has_automation and not has_clarify:
                logging.info("Plain text response (first 300 chars):\n%s", text[:300])
        yield b"data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
