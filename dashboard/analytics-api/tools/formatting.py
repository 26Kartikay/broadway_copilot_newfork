"""
Compact terminal / markdown-friendly output (small tables, short section headers).
"""

from __future__ import annotations

import pandas as pd


def _trim_cell(value: str, max_width: int) -> str:
    s = value.replace("\n", " ").replace("\r", "")
    if len(s) <= max_width:
        return s
    if max_width <= 1:
        return "…"
    return s[: max_width - 1] + "…"


def dataframe_to_compact_table(
    df: pd.DataFrame,
    *,
    max_rows: int = 5,
    max_cell_width: int = 20,
) -> str:
    """Lightweight pipe table (renders cleanly in Streamlit markdown)."""
    if df.empty:
        return "_(no rows)_"

    view = df.head(max_rows).copy()
    view = view.where(pd.notna(view), "·")

    cols = [str(c) for c in view.columns]
    cells: list[list[str]] = []
    for _, row in view.iterrows():
        cells.append([_trim_cell(str(v), max_cell_width) for v in row.tolist()])

    header = "| " + " | ".join(_trim_cell(c, max_cell_width) for c in cols) + " |"
    divider = "| " + " | ".join("---" for _ in cols) + " |"
    lines = [header, divider]
    for r in cells:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def format_sql_tool_output(df: pd.DataFrame, row_count: int, *, preview_rows: int = 5) -> str:
    """Short block for execute_sql_query_tool."""
    shown = min(preview_rows, row_count, len(df))
    meta = f"_{row_count} rows · showing {shown}_\n\n"
    tbl = dataframe_to_compact_table(df, max_rows=preview_rows, max_cell_width=22)
    return meta + tbl


def format_analysis_section(title: str, body: str) -> str:
    """Small section header + body (no wide ASCII rules)."""
    t = title.strip()
    inner = body.rstrip()
    return f"\n**{t}**\n{inner}\n"
