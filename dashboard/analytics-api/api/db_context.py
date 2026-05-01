"""Per-request analytics database selection (sync routes + threaded uvicorn)."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Optional

from starlette.requests import Request

from api.database_registry import registry

_current_db_id: ContextVar[Optional[str]] = ContextVar("analytics_db_id", default=None)


def bind_database(request: Request, body_database_id: Optional[str] = None) -> Any:
    """
    Resolve database id from body field (highest priority), then header,
    then query ?database=, then default first DB.
    """
    hdr = request.headers.get("x-analytics-database") or request.headers.get("X-Analytics-Database")
    q = request.query_params.get("database")
    raw = (body_database_id or hdr or q or "").strip() or None
    resolved = registry.resolve_db_id(raw)
    return _current_db_id.set(resolved)


def reset_database(token: Any) -> None:
    _current_db_id.reset(token)


def get_resolved_db_id() -> str:
    """Current request's database id (must call bind_database first)."""
    v = _current_db_id.get()
    return registry.resolve_db_id(v)


def get_connection_string() -> str:
    return registry.get_url(get_resolved_db_id())
