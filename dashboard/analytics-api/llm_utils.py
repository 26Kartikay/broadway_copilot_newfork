"""
llm_utils.py — Utilities for interacting with Large Language Models.
"""

from __future__ import annotations

import os
import requests
from typing import Any, Optional

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

# ── Configuration ─────────────────────────────────────────────────────────────

OLLAMA_URL: str = "http://localhost:11434/api/generate"
MODEL: str = "qwen2.5-coder:7b"
MAX_RETRIES: int = 2

OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
MAX_EXEC_RETRIES: int = int(os.getenv("MAX_EXEC_RETRIES", "4"))
# Seconds (connect + read). Increase if you see "Request timed out" from OpenAI.
OPENAI_TIMEOUT: float = float(os.getenv("OPENAI_TIMEOUT", "180"))
OPENAI_MAX_RETRIES: int = int(os.getenv("OPENAI_MAX_RETRIES", "3"))


def get_db_dialect_sql_guidance() -> str:
    """
    Short SQL rules for the configured engine (current analytics DB when bound).
    Helps planners/implementers avoid invalid patterns (e.g. LIKE on dates in PostgreSQL).
    """
    try:
        from api.db_context import get_connection_string

        cs = (get_connection_string() or "").lower()
    except Exception:
        cs = (os.getenv("DB_CONNECTION_STRING") or "").lower()
    if "postgres" in cs:
        return (
            "Engine: PostgreSQL.\n"
            "- Many app DBs store timestamps as **text**. You CANNOT use `(col AT TIME ZONE 'UTC')` on text — "
            "PostgreSQL errors with undefined function timezone(unknown, text). Cast first.\n"
            "  Safe same-day filter (works for text, timestamp, timestamptz if ISO-like):\n"
            "    `col::date = CURRENT_DATE`  OR  `(col::timestamptz AT TIME ZONE 'UTC')::date = CURRENT_DATE`\n"
            "  Only use `AT TIME ZONE` on **timestamptz** or after `::timestamptz` / `::timestamp`.\n"
            "- Never use LIKE between a text/timestamp column and CURRENT_DATE.\n"
            "- Use ILIKE or LOWER(column) for case-insensitive channel names.\n"
        )
    if "mysql" in cs or "mariadb" in cs:
        return (
            "Engine: MySQL/MariaDB.\n"
            "- Filter by date with DATE(column) = CURDATE() or column >= CURDATE() AND column < CURDATE() + INTERVAL 1 DAY.\n"
        )
    if "sqlite" in cs:
        return (
            "Engine: SQLite.\n"
            "- Use date(column) = date('now') for same-day filters where appropriate.\n"
        )
    return (
        "Engine: unknown from connection string.\n"
        "- Avoid LIKE between text timestamps and bare dates; use explicit date functions or casts for the actual engine.\n"
    )


def is_openai_configured() -> bool:
    return bool((os.getenv("OPENAI_API_KEY") or "").strip())


def openai_chat(system: str, user: str, model: Optional[str] = None, temperature: float = 0.2) -> str:
    """
    Chat completion via OpenAI API. Caller must check is_openai_configured() first.
    Retries on timeout; uses OPENAI_TIMEOUT / OPENAI_MAX_RETRIES from env.
    """
    import time

    from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return ""

    base_url = (os.getenv("OPENAI_BASE_URL") or "").strip() or None
    client = OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=OPENAI_TIMEOUT,
        max_retries=0,
    )
    use_model = model or OPENAI_MODEL

    last_err: Optional[BaseException] = None
    for attempt in range(OPENAI_MAX_RETRIES):
        try:
            resp = client.chat.completions.create(
                model=use_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=temperature,
                timeout=OPENAI_TIMEOUT,
            )
            msg = resp.choices[0].message.content
            return (msg or "").strip()
        except (APITimeoutError, APIConnectionError, RateLimitError) as e:
            last_err = e
            if attempt + 1 < OPENAI_MAX_RETRIES:
                time.sleep(1.5 * (attempt + 1))
            continue
        except Exception as e:
            last_err = e
            break

    raise RuntimeError(str(last_err) if last_err else "OpenAI request failed")


# ── LLM helper ────────────────────────────────────────────────────────────────

def generate_with_ollama(prompt: str, system: str = "") -> str:
    """Send a prompt to Ollama."""
    payload: dict[str, Any] = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
    }
    if system:
        payload["system"] = system

    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
        resp.raise_for_status()
    except requests.exceptions.ConnectionError:
        raise RuntimeError("Cannot connect to Ollama. Ensure 'ollama serve' is running.")

    return resp.json().get("response", "").strip()
