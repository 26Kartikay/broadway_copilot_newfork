"""
context_builder.py — Extracts structured metadata from a pandas DataFrame.
"""

from __future__ import annotations

import json
import pandas as pd
from pydantic import BaseModel
from typing import Any


class DatasetContext(BaseModel):
    """Structured representation of a dataset's metadata."""

    row_count: int
    column_names: list[str]
    column_types: dict[str, str]
    sample_rows: list[dict[str, Any]]
    summary_statistics: dict[str, Any]
    unique_counts: dict[str, int]
    missing_counts: dict[str, int]


def build_context(df: pd.DataFrame) -> DatasetContext:
    """
    Analyse a DataFrame and return a DatasetContext with key metadata.

    Args:
        df: The pandas DataFrame to inspect.

    Returns:
        A DatasetContext instance with column info, samples, and stats.
    """
    summary_raw = df.describe(include="all").fillna("N/A").to_dict()
    # Convert inner values to plain Python types for JSON serialisation
    summary_clean: dict[str, Any] = {
        col: {k: (v if v != "N/A" else None) for k, v in stats.items()}
        for col, stats in summary_raw.items()
    }

    return DatasetContext(
        row_count=len(df),
        column_names=df.columns.tolist(),
        column_types={col: str(dtype) for col, dtype in df.dtypes.items()},
        sample_rows=df.head(5).fillna("").to_dict(orient="records"),
        summary_statistics=summary_clean,
        unique_counts={col: int(df[col].nunique()) for col in df.columns},
        missing_counts={col: int(df[col].isna().sum()) for col in df.columns},
    )


def context_to_prompt_str(ctx: DatasetContext) -> str:
    """
    Serialise a DatasetContext to a compact JSON string suitable for an LLM prompt.

    Args:
        ctx: The DatasetContext to serialise.

    Returns:
        A JSON string.
    """
    return json.dumps(ctx.model_dump(), indent=2, default=str)
