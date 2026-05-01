"""
analytics_service.py — Core service layer for the analytics API.
Reuses existing sql_tools.py for DB access; uses OpenAI (default gpt-4o-mini) for LLM calls.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.sql_tools import fetch_sql_select_dataframe, get_sql_schema_tool, is_safe_sql
from llm_utils import get_db_dialect_sql_guidance, is_openai_configured, openai_chat


# Extra patterns that indicate data-exfiltration or privilege escalation attempts.
# These complement the keyword check with regex-level detection.
# Do not match "--" or "/*" here: LLMs often add SQL comments; is_safe_sql already strips
# comments before keyword checks. Blind substring checks false-positive on comments and break NL→SQL.
_DANGEROUS_PATTERNS: List[tuple[str, str]] = [
    (r";\s*\S",              "Multiple statements detected"),
    (r"\bINTO\s+OUTFILE\b",  "File write attempt (INTO OUTFILE)"),
    (r"\bLOAD_FILE\b",       "File read attempt (LOAD_FILE)"),
    (r"\bxp_cmdshell\b",     "Shell execution attempt"),
    (r"\bINFORMATION_SCHEMA\b.*\bTABLES\b.*\bWHERE\b.*\bTABLE_SCHEMA\b\s*!=",
     "Schema enumeration attempt"),
    (r"\bSLEEP\s*\(",        "Time-based injection attempt (SLEEP)"),
    (r"\bBENCHMARK\s*\(",    "Time-based injection attempt (BENCHMARK)"),
    (r"\bPG_SLEEP\s*\(",     "Time-based injection attempt (pg_sleep)"),
]


def validate_sql(sql: str) -> None:
    """
    Raise ValueError if the SQL is destructive, contains injections, or is not
    a plain SELECT/WITH statement.

    Two-layer check:
      1. is_safe_sql — keyword + structure check from sql_tools
      2. _DANGEROUS_PATTERNS — regex patterns for comment/injection/exfil techniques
    """
    if not sql or not sql.strip():
        raise ValueError("Empty SQL query")

    ok, reason = is_safe_sql(sql)
    if not ok:
        raise ValueError(f"Query rejected: {reason}")

    normalized = sql.upper()
    for pattern, label in _DANGEROUS_PATTERNS:
        if re.search(pattern, normalized, re.IGNORECASE):
            raise ValueError(f"Query rejected: {label}")


QUERY_SYSTEM = """You are an expert SQL analyst. Given a user's natural language question and the database schema, produce:
1. A safe SELECT SQL query that answers the question
2. The best chart type to visualize the result
3. Which columns to use for axes

Output ONLY valid JSON matching this schema exactly:
{
  "sql": "<SELECT query>",
  "chart_type": "bar" | "line" | "pie" | "scatter" | "table",
  "x_axis": "<column name or null>",
  "y_axis": "<column name or null>",
  "title": "<chart title>",
  "description": "<one-sentence description of what this shows>"
}

Rules:
- sql must be a single SELECT statement, no semicolon at end
- Never use backticks; use double quotes for identifiers with spaces
- For time-series data → line chart
- For category comparisons → bar chart
- For distributions/percentages → pie chart
- For correlations between two numeric fields → scatter chart
- For raw tabular data / complex joins → table
- If the question is unanswerable from the schema, still return valid JSON with sql="" and chart_type="table"
"""

INSIGHT_SYSTEM = """You are a senior data analyst. Given a user's question and the query results, provide a concise, actionable insight.
- 2-4 sentences maximum
- Focus on the most important finding
- Highlight anomalies, trends, or business implications
- Be specific with numbers from the data
"""


def get_schema_structured() -> List[Dict[str, Any]]:
    """Return DB schema as a list of {table, columns: [{name, type}]}."""
    try:
        from sqlalchemy import inspect

        from tools.sql_tools import get_engine

        engine = get_engine()
        inspector = inspect(engine)
        tables = inspector.get_table_names()

        accessible_env = os.getenv("ACCESSIBLE_TABLES")
        if accessible_env:
            allowed = {t.strip().lower() for t in accessible_env.split(",")}
            tables = [t for t in tables if t.lower() in allowed]

        result = []
        for table_name in tables:
            cols = inspector.get_columns(table_name)
            result.append(
                {
                    "table": table_name,
                    "columns": [
                        {"name": c["name"], "type": str(c["type"])} for c in cols
                    ],
                }
            )
        return result
    except Exception as e:
        raise RuntimeError(f"Failed to read schema: {e}") from e


def nl_to_query(
    question: str, model: Optional[str] = None
) -> Tuple[str, str, str, Optional[str], Optional[str], str]:
    """
    Convert natural language to SQL + chart config via OpenAI.

    Returns:
        (sql, chart_type, title, x_axis, y_axis, description)
    """
    if not is_openai_configured():
        raise RuntimeError("OPENAI_API_KEY not configured")

    schema = get_sql_schema_tool()
    dialect = get_db_dialect_sql_guidance()
    user_msg = f"Schema:\n{schema}\n\nDialect rules:\n{dialect}\n\nQuestion: {question}"

    raw = openai_chat(QUERY_SYSTEM, user_msg, model=model)

    json_match = re.search(r"\{[\s\S]*\}", raw)
    if not json_match:
        raise ValueError(f"Model did not return JSON. Raw response: {raw[:300]}")

    parsed = json.loads(json_match.group(0))

    sql = parsed.get("sql", "").strip().rstrip(";")
    chart_type = parsed.get("chart_type", "table")
    x_axis = parsed.get("x_axis") or None
    y_axis = parsed.get("y_axis") or None
    title = parsed.get("title", question[:60])
    description = parsed.get("description", "")

    # Validate before returning — reject destructive SQL even if the model generated it
    if sql:
        validate_sql(sql)

    return sql, chart_type, title, x_axis, y_axis, description


def execute_query(sql: str) -> Tuple[List[str], List[Dict[str, Any]], int]:
    """Execute a SQL SELECT and return (columns, rows, row_count)."""
    validate_sql(sql)  # second gate: catches raw SQL submitted directly via /query/sql
    df, err = fetch_sql_select_dataframe(sql)
    if err:
        raise ValueError(err)
    if df is None or df.empty:
        return [], [], 0

    columns = list(df.columns)
    rows = json.loads(df.to_json(orient="records", date_format="iso", default_handler=str))
    return columns, rows, len(rows)


def generate_insight(
    question: str,
    columns: List[str],
    rows: List[Dict[str, Any]],
    model: Optional[str] = None,
) -> str:
    """Generate a natural-language insight from query results via OpenAI."""
    if not is_openai_configured():
        return ""

    preview = rows[:20]
    user_msg = (
        f"Question: {question}\n\n"
        f"Columns: {columns}\n\n"
        f"Sample data ({len(preview)} of {len(rows)} rows):\n"
        f"{json.dumps(preview, default=str, indent=2)}"
    )

    return openai_chat(INSIGHT_SYSTEM, user_msg, model=model)
