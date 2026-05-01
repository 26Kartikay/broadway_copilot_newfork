"""
analytics_service.py — Core service layer for the analytics API.
Reuses existing sql_tools.py for DB access; uses OpenAI (default gpt-4o-mini) for LLM calls.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.sql_tools import fetch_sql_select_dataframe, get_sql_schema_tool, is_safe_sql
from llm_utils import get_db_dialect_sql_guidance, is_openai_configured, openai_chat

logger = logging.getLogger(__name__)

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
  "description": "<one-sentence description of what this shows; if sql is empty, explain why and state detected intent>"
}

Rules:
- Use ONLY tables and column names that appear verbatim in the Schema section above. Never invent columns (e.g. channel, type, category) unless they are explicitly listed for that table.
- For shipment / notification / delivery questions: prefer tables shown in the schema (e.g. shipment_events, orders). Map "notifications sent" to whatever event_type or status columns exist on those tables.
- If comparing hyperlocal vs intercity: use a column that exists (delivery_mode, order_type, service_type, etc.). If only separate tables exist for each, use UNION ALL with a literal category column. If impossible from schema, return sql="" and explain clearly in description.
- If the question asks to compare concepts (e.g. intercity vs hyperlocal) but no column encodes that in the schema, return sql="" and explain in description that the schema does not show how to split those categories, or join/use the tables that do list them.
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

    try:
        from api.db_context import get_resolved_db_id

        db_id = get_resolved_db_id()
    except Exception:
        db_id = "(unknown)"

    raw_for_log = raw if len(raw) <= 4000 else raw[:4000] + "…(truncated)"

    if sql:
        logger.info(
            "analytics nl_to_sql ok db_id=%s intent_title=%r chart=%s sql=%s",
            db_id,
            title,
            chart_type,
            sql[:2000] + ("…" if len(sql) > 2000 else ""),
        )
        logger.debug("analytics nl_to_sql raw_model_response=%s", raw_for_log)
    else:
        logger.warning(
            "analytics nl_to_sql empty_sql db_id=%s question=%r intent_title=%r description=%r raw=%s",
            db_id,
            question[:500],
            title,
            description,
            raw_for_log,
        )

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


# ──────────────────────────────────────────────────────────────────────────────
# Agentic Loop
# ──────────────────────────────────────────────────────────────────────────────

import time
import uuid as _uuid
from typing import Callable

PARSE_SYSTEM = """You are a data analytics intent parser. Given a user's question, extract structured intent.

Output ONLY valid JSON (no markdown fences):
{
  "intent": "<one-line description of what the user wants to find>",
  "entities": ["<table or column names mentioned>"],
  "metrics": ["<aggregates or measures needed>"],
  "filters": ["<conditions or filters>"],
  "complexity": "simple" | "medium" | "complex"
}"""

REACT_QUERY_SYSTEM = """You are an expert SQL analyst. Before writing any SQL you MUST reason through the problem.

You will be given:
- ALL tables with their EXACT column lists (authoritative — do not use any other column names)
- Sample rows from the most relevant tables showing real values
- Potential JOIN relationships between tables

Follow this reasoning process:
STEP 1 - RELEVANT TABLES: Which tables contain the data? Cross-check column names with the question.
STEP 2 - EXACT COLUMNS: For each table you'll use, list the exact column names you can see. Never guess.
STEP 3 - JOINS NEEDED: If data spans multiple tables, identify join keys visible in both tables.
STEP 4 - FILTERS & AGGREGATIONS: What WHERE/GROUP BY/aggregate logic is needed?
STEP 5 - WRITE SQL: Only now write the SELECT.

Output ONLY valid JSON (no markdown fences):
{
  "reasoning": "<your step-by-step analysis from the 5 steps above>",
  "tables_used": ["table1", "table2"],
  "sql": "<single SELECT query, no trailing semicolon>",
  "chart_type": "bar" | "line" | "pie" | "scatter" | "table",
  "x_axis": "<exact column name or null>",
  "y_axis": "<exact column name or null>",
  "title": "<chart title>",
  "description": "<one-sentence description; if sql empty, explain why and what was tried>"
}

ABSOLUTE RULES — violations cause query failure:
- ONLY use column names you can see in the "Exact columns" lists below. Zero exceptions.
- ONLY use table names listed below. Zero exceptions.
- If the question cannot be answered from the available columns, return sql="" and explain in description.
- Never invent or guess column names. Never assume a column exists unless you see it.
- No semicolon at end of sql."""

REFINE_SYSTEM = """You are an expert SQL analyst correcting a failed database query.
You have the full schema, sample data showing REAL column names and values, and the specific errors to fix.

Output ONLY valid JSON (no markdown fences):
{
  "reasoning": "<diagnose exactly why the previous SQL failed, then plan the fix>",
  "tables_used": ["table1", "table2"],
  "sql": "<corrected SELECT query, no trailing semicolon>",
  "chart_type": "bar" | "line" | "pie" | "scatter" | "table",
  "x_axis": "<exact column name or null>",
  "y_axis": "<exact column name or null>",
  "title": "<chart title>",
  "description": "<one-sentence description>",
  "changes_made": "<what was wrong and what was fixed>"
}

ABSOLUTE RULES:
- Use ONLY column names you can see in the schema/sample below — not from memory, not guessed.
- If a referenced column does not exist, find the correct column name in the sample data.
- Every listed issue must be addressed."""

EXPLORE_SYSTEM = """You are a database analyst selecting tables to examine in depth.
Given the question and ALL available tables with their columns, choose which tables to sample (run SELECT * LIMIT 2 on).

Output ONLY valid JSON (no markdown fences):
{
  "tables_to_sample": ["table1", "table2", "table3"],
  "reasoning": "<why these specific tables are most relevant>"
}

Rules:
- Select 3-5 tables maximum
- Choose tables most likely to contain the data needed to answer the question
- Prefer tables whose column names align with entities/metrics in the question"""


def parse_user_query(query: str, model: Optional[str] = None) -> Dict[str, Any]:
    """Extract structured intent from a natural language question."""
    if not is_openai_configured():
        return {"intent": query, "entities": [], "metrics": [], "filters": [], "complexity": "simple"}
    try:
        raw = openai_chat(PARSE_SYSTEM, f"Question: {query}", model=model)
        json_match = re.search(r"\{[\s\S]*\}", raw)
        if json_match:
            return json.loads(json_match.group(0))
    except Exception as e:
        logger.warning("parse_user_query failed: %s", e)
    return {"intent": query, "entities": [], "metrics": [], "filters": [], "complexity": "simple"}


def _discover_joins(table_columns: Dict[str, List[str]]) -> List[Dict[str, str]]:
    """
    Detect potential JOIN paths by:
    1. Looking for <table>_id columns in other tables (FK pattern)
    2. Finding same non-generic column names across tables
    """
    GENERIC = {"id", "created_at", "updated_at", "deleted_at", "status", "name",
               "description", "type", "code", "value", "notes", "metadata"}
    joins: List[Dict[str, str]] = []
    seen: set = set()
    table_list = list(table_columns.keys())

    for t1 in table_list:
        cols1_lower = {c.lower(): c for c in table_columns[t1]}

        for t2 in table_list:
            if t1 == t2:
                continue
            cols2_lower = {c.lower(): c for c in table_columns[t2]}

            # FK pattern: t2_id exists in t1 → t1.t2_id = t2.id
            fk_col = f"{t2}_id"
            if fk_col in cols1_lower and "id" in cols2_lower:
                key = tuple(sorted([f"{t1}.{fk_col}", f"{t2}.id"]))
                if key not in seen:
                    seen.add(key)
                    joins.append({
                        "join": f'"{t1}" JOIN "{t2}" ON "{t1}"."{cols1_lower[fk_col]}" = "{t2}"."{cols2_lower["id"]}"',
                        "type": "foreign_key",
                    })

            # Shared non-generic column
            shared = (set(cols1_lower) & set(cols2_lower)) - GENERIC
            for col in shared:
                key = tuple(sorted([f"{t1}.{col}", f"{t2}.{col}"]))
                if key not in seen:
                    seen.add(key)
                    joins.append({
                        "join": f'"{t1}" JOIN "{t2}" ON "{t1}"."{cols1_lower[col]}" = "{t2}"."{cols2_lower[col]}"',
                        "type": "shared_column",
                    })

    return joins[:12]


def explore_schema(
    question: str,
    interpretation: Dict[str, Any],
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Comprehensive schema exploration — like Cursor reading a codebase before answering.

    1. Reads ALL tables and their exact column lists from the DB (fast, schema-only)
    2. Asks LLM which tables to actually sample (SELECT * LIMIT 2)
    3. Samples those tables so the model sees real values
    4. Discovers potential JOIN paths across all tables
    5. Returns a complete picture the query generator can trust
    """
    try:
        schema = get_schema_structured()
    except Exception as e:
        logger.warning("explore_schema: schema unavailable: %s", e)
        return {}

    table_map = {t["table"]: t for t in schema}
    if not table_map:
        return {}

    # Full column map for every table (no DB queries needed — from inspector)
    all_columns: Dict[str, List[str]] = {
        tname: [c["name"] for c in t["columns"]]
        for tname, t in table_map.items()
    }

    # Ask LLM which tables to sample for actual rows
    tables_to_sample: List[str] = []
    schema_summary = "\n".join(
        f"- {tname}: {', '.join(all_columns[tname])}"
        for tname in sorted(all_columns)
    )
    if is_openai_configured():
        user_msg = (
            f"Question: {question}\n"
            f"Intent: {interpretation.get('intent', '')}\n"
            f"Entities: {', '.join(interpretation.get('entities', []))}\n"
            f"Metrics: {', '.join(interpretation.get('metrics', []))}\n\n"
            f"ALL tables and their exact columns:\n{schema_summary}"
        )
        try:
            raw = openai_chat(EXPLORE_SYSTEM, user_msg, model=model)
            match = re.search(r"\{[\s\S]*\}", raw)
            if match:
                picks = json.loads(match.group(0)).get("tables_to_sample", [])
                tables_to_sample = [t for t in picks if t in table_map][:5]
        except Exception as e:
            logger.warning("explore_schema: LLM table selection failed: %s", e)

    # Keyword fallback
    if not tables_to_sample:
        q_lower = question.lower()
        for tname in table_map:
            parts = re.split(r"[_\s]", tname.lower())
            if any(p in q_lower for p in parts if len(p) > 2):
                tables_to_sample.append(tname)
        if not tables_to_sample:
            tables_to_sample = list(table_map.keys())[:3]
        tables_to_sample = tables_to_sample[:5]

    # Sample each chosen table
    sampled: Dict[str, Any] = {}
    for tname in tables_to_sample:
        if tname not in table_map:
            continue
        try:
            columns, rows, _ = execute_query(f'SELECT * FROM "{tname}" LIMIT 2')
            sampled[tname] = {"columns": columns, "sample_rows": rows}
            logger.info("explore_schema sampled table=%s rows=%d", tname, len(rows))
        except Exception as e:
            sampled[tname] = {"columns": [], "sample_rows": [], "error": str(e)}
            logger.warning("explore_schema sample_error table=%s err=%s", tname, e)

    # Discover joins across ALL tables
    joins = _discover_joins(all_columns)

    return {
        "all_columns": all_columns,        # {table: [col, ...]} for every table
        "sampled": sampled,                # {table: {columns, sample_rows}} for key tables
        "joins": joins,                    # [{join: "...", type: "..."}]
        "tables_to_sample": tables_to_sample,
    }


def _build_exploration_context(exploration: Dict[str, Any]) -> str:
    """Build the full schema context block injected into LLM prompts."""
    all_columns: Dict[str, List[str]] = exploration.get("all_columns", {})
    sampled: Dict[str, Any] = exploration.get("sampled", {})
    joins: List[Dict[str, str]] = exploration.get("joins", [])

    lines = ["=== ALL TABLES — EXACT COLUMN LISTS (authoritative) ==="]
    lines.append("These are the ONLY column names you may use. No others exist.\n")
    for tname in sorted(all_columns):
        cols = all_columns[tname]
        lines.append(f'Table "{tname}"')
        lines.append(f'  Exact columns: {", ".join(cols)}')

    if sampled:
        lines.append("\n=== SAMPLE ROWS FROM KEY TABLES (real values) ===")
        for tname, info in sampled.items():
            if info.get("error"):
                lines.append(f'\nTable "{tname}": sampling failed — {info["error"]}')
                continue
            rows = info.get("sample_rows", [])
            lines.append(f'\nTable "{tname}" — {len(rows)} sample row(s):')
            lines.append(json.dumps(rows, default=str, indent=2))

    if joins:
        lines.append("\n=== POTENTIAL JOIN PATHS DISCOVERED ===")
        for j in joins:
            lines.append(f'  [{j["type"]}] {j["join"]}')

    return "\n".join(lines)


def _pre_validate_sql_columns(sql: str, exploration: Dict[str, Any]) -> List[str]:
    """
    Fast pre-flight check: extract double-quoted identifiers from SQL and verify
    each is a known table or column. Catches hallucinated column names before
    the DB is hit, returning actionable error messages.
    """
    all_columns: Dict[str, List[str]] = exploration.get("all_columns", {})
    if not all_columns:
        return []

    # Build lookup
    known_tables = {t.lower() for t in all_columns}
    known_cols: Dict[str, List[str]] = {}  # lowercased col → tables that have it
    for tname, cols in all_columns.items():
        for col in cols:
            known_cols.setdefault(col.lower(), []).append(tname)

    # Strip AS aliases so they're not checked as column names
    sql_no_aliases = re.sub(r'\bAS\s+"[^"]+"\s*', ' ', sql, flags=re.IGNORECASE)
    identifiers = re.findall(r'"([^"]+)"', sql_no_aliases)

    issues: List[str] = []
    reported: set = set()

    for ident in identifiers:
        lower = ident.lower()
        if lower in known_tables or lower in known_cols or lower in reported:
            continue
        reported.add(lower)

        # Build a helpful per-table column guide for the error message
        table_guide = "; ".join(
            f'"{t}": [{", ".join(all_columns[t])}]'
            for t in sorted(all_columns)
        )
        issues.append(
            f'Column "{ident}" does not exist. '
            f'Available columns per table → {table_guide}'
        )

    return issues[:2]


def _nl_to_query_with_exploration(
    question: str,
    exploration: Dict[str, Any],
    model: Optional[str] = None,
) -> Tuple[str, str, str, Optional[str], Optional[str], str]:
    """
    ReAct-style query generation: the model first reasons through tables/joins/columns
    (using only what it can see in the exploration context) then writes SQL.
    """
    if not is_openai_configured():
        raise RuntimeError("OPENAI_API_KEY not configured")

    dialect = get_db_dialect_sql_guidance()
    exploration_ctx = _build_exploration_context(exploration)

    user_msg = (
        f"Dialect rules:\n{dialect}\n\n"
        f"{exploration_ctx}\n\n"
        f"Question: {question}"
    )

    raw = openai_chat(REACT_QUERY_SYSTEM, user_msg, model=model)
    json_match = re.search(r"\{[\s\S]*\}", raw)
    if not json_match:
        raise ValueError(f"Model did not return JSON. Raw: {raw[:300]}")

    parsed = json.loads(json_match.group(0))
    sql = parsed.get("sql", "").strip().rstrip(";")
    chart_type = parsed.get("chart_type", "table")
    x_axis = parsed.get("x_axis") or None
    y_axis = parsed.get("y_axis") or None
    title = parsed.get("title", question[:60])
    description = parsed.get("description", "")
    reasoning = parsed.get("reasoning", "")

    logger.info("react_query reasoning=%s sql=%s", reasoning[:200], (sql or "")[:300])

    if sql:
        validate_sql(sql)

    return sql, chart_type, title, x_axis, y_axis, description


def generate_implementation(
    interpretation: Dict[str, Any],
    question: str,
    exploration: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate SQL + visualization config. Uses sampled table data when available."""
    if exploration:
        sql, chart_type, title, x_axis, y_axis, description = _nl_to_query_with_exploration(
            question, exploration, model=model
        )
    else:
        sql, chart_type, title, x_axis, y_axis, description = nl_to_query(question, model=model)
    return {
        "sql": sql,
        "chart_type": chart_type,
        "title": title,
        "x_axis": x_axis,
        "y_axis": y_axis,
        "description": description,
    }


def validate_implementation(
    impl: Dict[str, Any],
    exploration: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Execute the SQL and check result quality. Returns validation dict.

    If exploration is provided, runs a column pre-validation check first to catch
    hallucinated column names before hitting the database.
    """
    sql = impl.get("sql", "").strip()
    if not sql:
        return {
            "is_valid": False,
            "issues": ["No SQL was generated — the question may be unanswerable from this schema"],
            "columns": [],
            "rows": [],
            "row_count": 0,
            "execution_time_ms": 0,
        }

    # Pre-flight: catch hallucinated column names before DB round-trip
    if exploration:
        col_issues = _pre_validate_sql_columns(sql, exploration)
        if col_issues:
            return {
                "is_valid": False,
                "issues": col_issues,
                "columns": [],
                "rows": [],
                "row_count": 0,
                "execution_time_ms": 0,
            }

    t0 = time.time()
    try:
        columns, rows, row_count = execute_query(sql)
        elapsed_ms = int((time.time() - t0) * 1000)
        issues: List[str] = []

        if elapsed_ms > 2000:
            issues.append(f"Query took {elapsed_ms}ms (exceeds 2000ms threshold)")
        if row_count == 0:
            issues.append("Query returned 0 rows — filter may be too restrictive or table is empty")

        return {
            "is_valid": len(issues) == 0,
            "issues": issues,
            "columns": columns,
            "rows": rows,
            "row_count": row_count,
            "execution_time_ms": elapsed_ms,
        }
    except Exception as e:
        elapsed_ms = int((time.time() - t0) * 1000)
        return {
            "is_valid": False,
            "issues": [str(e)],
            "columns": [],
            "rows": [],
            "row_count": 0,
            "execution_time_ms": elapsed_ms,
        }


def refine_implementation(
    original_question: str,
    failed_impl: Dict[str, Any],
    issues: List[str],
    iteration: int,
    exploration: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Regenerate SQL with corrections based on validation failures."""
    if not is_openai_configured():
        raise RuntimeError("OPENAI_API_KEY not configured")

    schema = get_sql_schema_tool()
    dialect = get_db_dialect_sql_guidance()

    exploration_ctx = _build_exploration_context(exploration) if exploration else f"Full schema:\n{schema}"

    user_msg = (
        f"Dialect rules:\n{dialect}\n\n"
        f"{exploration_ctx}\n\n"
        f"Original question: {original_question}\n\n"
        f"Failed SQL (attempt {iteration}):\n{failed_impl.get('sql', '(none)')}\n\n"
        f"Issues to fix:\n" + "\n".join(f"- {i}" for i in issues)
    )

    raw = openai_chat(REFINE_SYSTEM, user_msg, model=model)
    json_match = re.search(r"\{[\s\S]*\}", raw)
    if not json_match:
        raise ValueError(f"Refine model did not return JSON. Raw: {raw[:200]}")

    parsed = json.loads(json_match.group(0))
    sql = parsed.get("sql", "").strip().rstrip(";")
    if sql:
        validate_sql(sql)

    return {
        "sql": sql,
        "chart_type": parsed.get("chart_type", "table"),
        "title": parsed.get("title", original_question[:60]),
        "x_axis": parsed.get("x_axis") or None,
        "y_axis": parsed.get("y_axis") or None,
        "description": parsed.get("description", ""),
        "changes_made": parsed.get("changes_made", ""),
    }


def execute_agent_loop(
    query: str,
    callback: Callable[[Dict[str, Any]], None],
    model: Optional[str] = None,
    max_iterations: int = 3,
) -> None:
    """
    Run the full agentic loop: parse → implement → validate → refine (up to max_iterations).
    Invokes `callback` with structured events for real-time streaming.
    """

    def _log(
        step: str,
        status: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        duration_ms: int = 0,
    ) -> None:
        callback({
            "type": "log",
            "log": {
                "id": str(_uuid.uuid4()),
                "step": step,
                "status": status,
                "message": message,
                "timestamp": int(time.time() * 1000),
                "duration": duration_ms,
                "details": details or {},
            },
        })

    def _state(step: str, iteration: int = 0) -> None:
        callback({
            "type": "state",
            "step": step,
            "iterationCount": iteration,
            "maxIterations": max_iterations,
        })

    # ── Step 1: Parse ──────────────────────────────────────────────────────────
    _state("parsing")
    t0 = time.time()
    try:
        interpretation = parse_user_query(query, model=model)
        _log(
            "parsing", "success",
            f"Intent: {interpretation.get('intent', query)[:120]}",
            interpretation,
            int((time.time() - t0) * 1000),
        )
    except Exception as e:
        _log("parsing", "failed", f"Parse error: {e}", {}, int((time.time() - t0) * 1000))
        _state("error")
        callback({"type": "complete", "step": "error", "errorMessage": str(e)})
        return

    # ── Step 2: Explore schema ─────────────────────────────────────────────────
    _state("exploring")
    t0 = time.time()
    exploration: Dict[str, Any] = {}
    try:
        exploration = explore_schema(query, interpretation, model=model)
        all_cols = exploration.get("all_columns", {})
        sampled = exploration.get("sampled", {})
        joins = exploration.get("joins", [])
        good_samples = {k: v for k, v in sampled.items() if not v.get("error")}
        _log(
            "exploring", "success",
            (
                f"Mapped {len(all_cols)} table(s) · "
                f"sampled {len(good_samples)}: {', '.join(good_samples.keys()) or 'none'} · "
                f"{len(joins)} join path(s) found"
            ),
            {
                "all_tables": list(all_cols.keys()),
                "sampled_tables": list(good_samples.keys()),
                "joins": [j["join"] for j in joins[:4]],
            },
            int((time.time() - t0) * 1000),
        )
    except Exception as e:
        # Non-fatal — log and continue without sample data
        _log("exploring", "failed", f"Schema exploration failed: {e}", {}, int((time.time() - t0) * 1000))

    # ── Steps 3-5: Implement → Validate → Refine ──────────────────────────────
    impl: Optional[Dict[str, Any]] = None
    last_valid: Optional[Dict[str, Any]] = None
    validation: Dict[str, Any] = {"is_valid": False, "issues": [], "rows": []}

    for iteration in range(1, max_iterations + 1):
        step_name = "implementing" if iteration == 1 else "refining"
        _state(step_name, iteration)
        t0 = time.time()
        try:
            if iteration == 1:
                impl = generate_implementation(interpretation, query, exploration=exploration, model=model)
                _log(
                    "implementing", "success",
                    f"Generated: {impl.get('title', query)[:80]}",
                    {"sql": (impl.get("sql") or "")[:500]},
                    int((time.time() - t0) * 1000),
                )
            else:
                impl = refine_implementation(
                    query, impl or {}, validation.get("issues", []), iteration,
                    exploration=exploration, model=model,
                )
                _log(
                    "refining", "success",
                    f"Iteration {iteration}/{max_iterations} — {impl.get('changes_made', 'corrections applied')[:120]}",
                    {"sql": (impl.get("sql") or "")[:500]},
                    int((time.time() - t0) * 1000),
                )
        except Exception as e:
            _log(step_name, "failed", str(e)[:200], {}, int((time.time() - t0) * 1000))
            if last_valid:
                _state("complete", iteration)
                callback({"type": "complete", "step": "complete", **last_valid, "fallback": True, "iterationCount": iteration})
                return
            _state("error", iteration)
            callback({"type": "complete", "step": "error", "errorMessage": str(e)})
            return

        # Validate
        _state("validating", iteration)
        t0 = time.time()
        try:
            validation = validate_implementation(impl or {}, exploration=exploration)
            duration_ms = int((time.time() - t0) * 1000)
        except Exception as e:
            validation = {
                "is_valid": False, "issues": [str(e)],
                "rows": [], "columns": [], "row_count": 0, "execution_time_ms": 0,
            }
            duration_ms = int((time.time() - t0) * 1000)

        if validation["is_valid"]:
            _log(
                "validating", "success",
                f"{validation['row_count']} rows in {validation['execution_time_ms']}ms",
                {"row_count": validation["row_count"], "execution_time_ms": validation["execution_time_ms"]},
                duration_ms,
            )
            # Generate insight synchronously as final step
            insight: Optional[str] = None
            try:
                if validation.get("rows"):
                    insight = generate_insight(query, validation["columns"], validation["rows"], model=model)
            except Exception:
                pass

            result = {
                "implementation": impl,
                "validationResult": {
                    "isValid": True,
                    "rowCount": validation["row_count"],
                    "columns": validation["columns"],
                    "rows": validation["rows"],
                    "executionTimeMs": validation["execution_time_ms"],
                    "insight": insight,
                },
            }
            _state("complete", iteration)
            callback({"type": "complete", "step": "complete", **result, "iterationCount": iteration})
            return

        else:
            _log(
                "validating", "failed",
                "; ".join(validation["issues"])[:200],
                {"issues": validation["issues"]},
                duration_ms,
            )
            # Keep partial results as emergency fallback
            if validation.get("rows"):
                last_valid = {
                    "implementation": impl,
                    "validationResult": {
                        "isValid": False,
                        "rowCount": validation.get("row_count", 0),
                        "columns": validation.get("columns", []),
                        "rows": validation.get("rows", []),
                        "executionTimeMs": validation.get("execution_time_ms", 0),
                        "insight": None,
                    },
                }
            if iteration >= max_iterations:
                break

    # Max iterations exhausted
    _log("error", "failed", f"Max iterations ({max_iterations}) reached without a valid result", {}, 0)
    if last_valid:
        _state("complete", max_iterations)
        callback({
            "type": "complete", "step": "complete",
            **last_valid, "fallback": True, "iterationCount": max_iterations,
        })
    else:
        _state("error", max_iterations)
        callback({
            "type": "complete", "step": "error",
            "errorMessage": f"Could not generate a valid result after {max_iterations} attempts",
        })
