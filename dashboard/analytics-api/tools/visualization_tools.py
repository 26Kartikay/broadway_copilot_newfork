"""
visualization_tools.py — Save charts to PNG for CLI / headless use (files + SQL).
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

from data_manager import manager
from tools.sql_tools import fetch_sql_select_dataframe

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CHARTS_DIR = PROJECT_ROOT / "output" / "charts"


def _slug(text: str) -> str:
    s = re.sub(r"[^\w\-]+", "_", (text or "").lower()).strip("_")
    return (s[:48] or "chart").rstrip("_")


def _save_figure(title: Optional[str]) -> str:
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = CHARTS_DIR / f"{ts}_{_slug(title or 'chart')}.png"
    plt.tight_layout()
    plt.savefig(path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close()
    return str(path.resolve())


def _plot(
    df: pd.DataFrame,
    chart_type: str,
    x: Optional[str],
    y: Optional[str],
    hue: Optional[str],
    title: Optional[str],
    default_title: str,
) -> str:
    if df.empty:
        return "No rows to plot."

    ct = (chart_type or "bar").lower().strip()
    fig, ax = plt.subplots(figsize=(11, 6))

    if ct == "heatmap":
        numeric = df.select_dtypes(include=["number"])
        if numeric.shape[1] < 2:
            plt.close()
            return "Heatmap needs at least two numeric columns in the result."
        corr = numeric.corr()
        sns.heatmap(corr, annot=True, cmap="coolwarm", fmt=".2f", ax=ax)
    elif ct == "bar":
        if not x:
            plt.close()
            return "Bar chart requires x (category column)."
        if y and y in df.columns:
            sns.barplot(data=df, x=x, y=y, hue=hue, ax=ax)
        else:
            sns.countplot(data=df, x=x, hue=hue, ax=ax)
    elif ct == "line":
        if not x or not y:
            plt.close()
            return "Line chart requires both x and y column names."
        sns.lineplot(data=df, x=x, y=y, hue=hue, ax=ax)
    elif ct in ("hist", "histogram"):
        if not x:
            plt.close()
            return "Histogram requires x column."
        sns.histplot(data=df, x=x, hue=hue, kde=True, ax=ax)
    elif ct == "scatter":
        if not x or not y:
            plt.close()
            return "Scatter plot requires both x and y column names."
        sns.scatterplot(data=df, x=x, y=y, hue=hue, ax=ax)
    else:
        plt.close()
        return f"Unsupported chart type '{chart_type}'. Use bar, line, hist, scatter, or heatmap."

    ax.set_title(title or default_title)
    path = _save_figure(title or default_title)
    return f"**Chart:** `{path}`\n\n"


def visualization_tool(
    name: str,
    chart_type: str,
    x: Optional[str] = None,
    y: Optional[str] = None,
    hue: Optional[str] = None,
    title: Optional[str] = None,
) -> str:
    """
    Plot a loaded in-memory dataset and save a PNG under output/charts/.

    chart_type: bar | line | hist | scatter | heatmap
    For bar charts on raw rows, omit y to use count per x.
    """
    df = manager.get_dataset(name)
    if df is None:
        return f"Error: Dataset '{name}' not found. Load a file or use visualization_from_sql_tool."

    return _plot(df, chart_type, x, y, hue, title, f"{chart_type} — {name}")


def visualization_from_dataframe_tool(
    df: pd.DataFrame,
    chart_type: str,
    x: Optional[str] = None,
    y: Optional[str] = None,
    hue: Optional[str] = None,
    title: Optional[str] = None,
) -> str:
    """Same as visualization_tool but takes a pandas DataFrame (e.g. after aggregation in code)."""
    if not isinstance(df, pd.DataFrame):
        return "Error: First argument must be a pandas DataFrame."
    return _plot(df, chart_type, x, y, hue, title, title or f"{chart_type} chart")


def visualization_from_sql_tool(
    query: str,
    chart_type: str,
    x: Optional[str] = None,
    y: Optional[str] = None,
    hue: Optional[str] = None,
    title: Optional[str] = None,
) -> str:
    """
    Run a guarded SELECT, then plot the result. Use this when data lives in the SQL database
    (no in-memory dataset name).
    """
    df, err = fetch_sql_select_dataframe(query)
    if err:
        return err
    if df is None:
        return "Query produced no dataframe."
    return _plot(df, chart_type, x, y, hue, title, title or "SQL chart")
