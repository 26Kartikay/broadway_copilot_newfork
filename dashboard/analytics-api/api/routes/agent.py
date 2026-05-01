"""
agent.py — Streaming agentic loop endpoint.
Emits NDJSON events for real-time frontend updates.
"""
from __future__ import annotations

import asyncio
import json
import threading
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.requests import Request

from api.analytics_service import execute_agent_loop
from api.db_context import bind_database, reset_database

router = APIRouter()


class AgentQueryRequest(BaseModel):
    question: str
    model: Optional[str] = None
    database_id: Optional[str] = None


@router.post("/agent/query")
async def run_agent_query(request: Request, req: AgentQueryRequest):
    """Execute the agentic parse→implement→validate→refine loop, streaming NDJSON events."""
    token = bind_database(request, req.database_id)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

    def callback(event: dict) -> None:
        asyncio.run_coroutine_threadsafe(
            queue.put(json.dumps(event, default=str) + "\n"), loop
        )

    def run_sync() -> None:
        try:
            execute_agent_loop(req.question, callback, model=req.model)
        except Exception as e:
            asyncio.run_coroutine_threadsafe(
                queue.put(
                    json.dumps({"type": "complete", "step": "error", "errorMessage": str(e)}) + "\n"
                ),
                loop,
            )
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)
            reset_database(token)

    threading.Thread(target=run_sync, daemon=True).start()

    async def event_generator():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item

    return StreamingResponse(
        event_generator(),
        media_type="application/x-ndjson",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Transfer-Encoding": "chunked",
        },
    )
