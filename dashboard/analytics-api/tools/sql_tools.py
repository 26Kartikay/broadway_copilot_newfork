"""
sql_tools.py — Tools for querying and analyzing SQL databases with safety guardrails.
"""

from __future__ import annotations

import os
import re
import pandas as pd
from typing import Any, Dict, List, Optional
from sqlalchemy import create_engine, inspect, text

from tools.formatting import format_sql_tool_output


# ── SQL Safety Guardrails ───────────────────────────────────────────────────

# Keywords that indicate destructive or administrative operations
FORBIDDEN_KEYWORDS = {
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 
    'TRUNCATE', 'RENAME', 'REPLACE', 'GRANT', 'REVOKE', 'EXEC',
    'ATTACH', 'DETACH', 'VACUUM', 'PRAGMA', 'MERGE', 'UPSERT'
}

def is_safe_sql(query: str) -> tuple[bool, str]:
    """
    Checks if a SQL query is strictly a SELECT (read-only) operation.
    It cleans the query by removing comments and string literals before
    validating against forbidden keywords.
    Public alias used by analytics_service; _is_safe_sql kept as alias below.
    """
    # 1. Basic cleaning and normalization
    original_query = query.strip()
    
    # Remove comments to prevent bypasses (e.g. SEL/*comment*/ECT)
    # -- line comments
    clean_query = re.sub(r'--.*$', '', original_query, flags=re.MULTILINE)
    # /* block comments */
    clean_query = re.sub(r'/\*.*?\*/', ' ', clean_query, flags=re.DOTALL)
    
    # 2. Check for multiple statements (semicolon injection)
    # We allow a single semicolon at the very end
    if ';' in clean_query:
        temp_query = clean_query.strip().rstrip(';')
        if ';' in temp_query:
            return False, "Multiple SQL statements are not allowed."
            
    # 3. Strip string literals to avoid false positives 
    # (e.g., SELECT * FROM logs WHERE message = 'User deleted')
    # Replace contents of '...' and "..." with spaces
    query_no_strings = re.sub(r"'(?:''|[^'])*'", "' '", clean_query)
    query_no_strings = re.sub(r'"(?:""|[^"])*"', '" "', query_no_strings)
    
    # 4. Final safety check on the "cleaned" query
    normalized = query_no_strings.strip().upper()
    
    # Must start with SELECT or WITH
    if not (normalized.startswith('SELECT') or normalized.startswith('WITH')):
        return False, "Query must be a SELECT or WITH statement."
    
    # Tokenize and check for forbidden keywords
    tokens = set(re.findall(r'\b\w+\b', normalized))
    forbidden_found = FORBIDDEN_KEYWORDS.intersection(tokens)
    if forbidden_found:
        return False, f"Forbidden keyword(s) detected: {', '.join(forbidden_found)}"
        
    return True, ""


# Backward-compatible private alias
_is_safe_sql = is_safe_sql


# ── Database Connection ─────────────────────────────────────────────────────

_engine_by_db_id: Dict[str, Any] = {}


def get_engine():
    """
    SQLAlchemy engine for the current analytics database (see api.db_context).
    Cached per database id.
    """
    from api.db_context import get_connection_string, get_resolved_db_id

    db_id = get_resolved_db_id()
    if db_id not in _engine_by_db_id:
        cs = get_connection_string()
        _engine_by_db_id[db_id] = create_engine(cs)
    return _engine_by_db_id[db_id]


def _get_db_connection():
    """Backward-compatible alias used inside this module."""
    return get_engine()


# ── Tool Implementations ────────────────────────────────────────────────────

def get_sql_schema_tool() -> str:
    """
    Analyze the database schema to understand available tables and columns.
    Respects ACCESSIBLE_TABLES environment variable.
    
    Returns:
        A summary of the database schema (tables and their columns).
    """
    try:
        engine = _get_db_connection()
        inspector = inspect(engine)
        
        # Get list of tables
        tables = inspector.get_table_names()
        
        # Filter by accessible tables if configured
        accessible_tables_env = os.getenv('ACCESSIBLE_TABLES')
        if accessible_tables_env:
            allowed = {t.strip().lower() for t in accessible_tables_env.split(',')}
            tables = [t for t in tables if t.lower() in allowed]
            
        if not tables:
            return "No accessible tables found in the database."
            
        schema_info = "Database Schema Analysis:\n"
        for table_name in tables:
            schema_info += f"\n- Table: {table_name}\n"
            columns = inspector.get_columns(table_name)
            for col in columns:
                col_name = col['name']
                col_type = str(col['type'])
                pk = " (PK)" if col.get('primary_key') else ""
                schema_info += f"  - {col_name} {col_type}{pk}\n"
        
        return schema_info
    except Exception as e:
        return f"Error analyzing database schema: {str(e)}"


def fetch_sql_select_dataframe(query: str) -> tuple[Optional[pd.DataFrame], str]:
    """
    Run a guarded SELECT and return (DataFrame, error_message).
    On success, error_message is "". On failure, DataFrame is None.
    """
    is_safe, reason = _is_safe_sql(query)
    if not is_safe:
        return None, f"Query rejected: {reason}"

    accessible_tables_env = os.getenv("ACCESSIBLE_TABLES")
    if accessible_tables_env:
        allowed = {t.strip().lower() for t in accessible_tables_env.split(",")}
        tables_in_query = re.findall(
            r"\b(?:FROM|JOIN)\s+([a-zA-Z0-9_]+)", query, re.IGNORECASE
        )
        for t in tables_in_query:
            if t.lower() not in allowed:
                return (
                    None,
                    f"Query rejected: Table '{t}' is not in the allowed list (ACCESSIBLE_TABLES).",
                )

    try:
        engine = _get_db_connection()
        with engine.connect() as conn:
            df = pd.read_sql_query(text(query), conn)
        return df, ""
    except Exception as e:
        return None, f"SQL query execution error: {str(e)}"


def execute_sql_query_tool(query: str) -> str:
    """
    Execute a SQL SELECT query on the database.
    Checks for safety and respects ACCESSIBLE_TABLES.

    Args:
        query: The SQL SELECT query to execute.

    Returns:
        Result summary or preview rows from the query.
    """
    df, err = fetch_sql_select_dataframe(query)
    if err:
        return err
    if df.empty:
        return "Query executed successfully, but returned no results."

    row_count = len(df)
    return format_sql_tool_output(df, row_count, preview_rows=10)
