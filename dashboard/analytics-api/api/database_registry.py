"""
Server-side registry of analytics databases. URLs never leave the server;
clients only send a database id chosen from GET /api/databases.

Configure via ANALYTICS_DATABASES (JSON array). Example:

ANALYTICS_DATABASES=[{"id":"app","label":"App DB","url":"postgresql://..."},{"id":"rw","label":"Read replica","url":"postgresql://..."}]

If ANALYTICS_DATABASES is unset, falls back to DB_CONNECTION_STRING as a single entry id "default".
Max entries: ANALYTICS_DATABASE_MAX (default 12).
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]{0,63}$")


def _normalize_connection_url(raw: str) -> str:
    cs = (raw or "").strip()
    if not cs:
        return "sqlite:///data.db"
    if "://" not in cs:
        cs = f"sqlite:///{cs}"
    return cs.replace("+asyncpg", "")


class DatabaseRegistry:
    def __init__(self) -> None:
        self._entries: List[Dict[str, str]] = []
        self._by_id: Dict[str, str] = {}
        self._load()

    def _load(self) -> None:
        max_n = max(1, min(32, int(os.getenv("ANALYTICS_DATABASE_MAX", "12"))))
        raw = (os.getenv("ANALYTICS_DATABASES") or "").strip()

        if raw:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as e:
                raise RuntimeError(f"ANALYTICS_DATABASES is not valid JSON: {e}") from e
            if not isinstance(data, list):
                raise RuntimeError("ANALYTICS_DATABASES must be a JSON array")
            if len(data) > max_n:
                raise RuntimeError(f"Too many databases configured (max {max_n})")

            seen: set[str] = set()
            entries: List[Dict[str, str]] = []
            by_id: Dict[str, str] = {}
            for i, item in enumerate(data):
                if not isinstance(item, dict):
                    raise RuntimeError(f"ANALYTICS_DATABASES[{i}] must be an object")
                db_id = str(item.get("id") or "").strip()
                label = str(item.get("label") or db_id).strip() or db_id
                url = str(item.get("url") or "").strip()
                if not db_id or not _ID_RE.match(db_id):
                    raise RuntimeError(
                        f"Invalid database id at index {i}: use letters, digits, underscore, hyphen "
                        "(must start with a letter)."
                    )
                if not url:
                    raise RuntimeError(f"Missing url for database id {db_id!r}")
                if db_id in seen:
                    raise RuntimeError(f"Duplicate database id: {db_id}")
                seen.add(db_id)
                nu = _normalize_connection_url(url)
                entries.append({"id": db_id, "label": label, "url": nu})
                by_id[db_id] = nu

            self._entries = entries
            self._by_id = by_id
            return

        fallback = os.getenv("DB_CONNECTION_STRING", "sqlite:///data.db")
        nu = _normalize_connection_url(fallback)
        self._entries = [{"id": "default", "label": "Default", "url": nu}]
        self._by_id = {"default": nu}

    def list_public(self) -> List[Dict[str, str]]:
        """Ids and labels only (no URLs)."""
        return [{"id": e["id"], "label": e["label"]} for e in self._entries]

    def resolve_db_id(self, requested: Optional[str]) -> str:
        if not self._entries:
            raise RuntimeError("No databases configured")
        if not requested or not str(requested).strip():
            return self._entries[0]["id"]
        rid = str(requested).strip()
        if rid not in self._by_id:
            allowed = ", ".join(sorted(self._by_id.keys()))
            raise ValueError(f"Unknown database id {rid!r}. Allowed: {allowed}")
        return rid

    def get_url(self, db_id: str) -> str:
        if db_id not in self._by_id:
            raise ValueError(f"Unknown database id: {db_id}")
        return self._by_id[db_id]


registry = DatabaseRegistry()
