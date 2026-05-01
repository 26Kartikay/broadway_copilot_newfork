"""
tools.py — DataFrame manipulation tools that the agent can invoke.
"""

from __future__ import annotations

import pandas as pd
from typing import Any
from executor import execute_code


# Module-level DataFrame shared across all tools
_df: pd.DataFrame | None = None


def set_dataframe(df: pd.DataFrame) -> None:
    """Inject the global DataFrame used by all tools."""
    global _df
    _df = df


def get_dataframe() -> pd.DataFrame:
    """Return the current global DataFrame, raising if not loaded."""
    if _df is None:
        raise RuntimeError("No DataFrame loaded. Call load_csv() first.")
    return _df


# ── Individual tools ──────────────────────────────────────────────────────────

def load_csv(file_path: str) -> str:
    """
    Load a CSV file into the global DataFrame and clean it.

    Args:
        file_path: Absolute or relative path to the CSV.

    Returns:
        A confirmation string with cleaned column names.
    """
    global _df
    df = pd.read_csv(file_path)
    
    # 1. Strip leading/trailing spaces from column names
    df.columns = df.columns.str.strip()
    
    # 2. Normalize trip_duration if it exists (e.g. "30 minutes" -> 30)
    # We create a new column 'trip_duration_minutes' for safety
    if 'trip_duration' in df.columns:
        # Extract numeric part (handles "30", "30 mins", "30.5", etc)
        # Using a simple regex to find the first numeric sequence
        extracted = df['trip_duration'].astype(str).str.extract(r'(\d+\.?\d*)')[0]
        df['trip_duration_minutes'] = pd.to_numeric(extracted, errors='coerce')
    
    _df = df
    cols_list = df.columns.tolist()
    return f"Loaded {len(df)} rows. Cleaned Columns: {cols_list}"


def get_schema() -> dict[str, str]:
    """Return a mapping of column names to their dtypes."""
    df = get_dataframe()
    return {col: str(dtype) for col, dtype in df.dtypes.items()}


def get_summary() -> str:
    """Return df.describe() as a formatted string."""
    df = get_dataframe()
    return df.describe(include="all").fillna("N/A").to_string()


def filter_data(column: str, value: Any) -> pd.DataFrame:
    """
    Filter the DataFrame by an equality condition.

    Args:
        column: Column name to filter on.
        value:  Value to match.

    Returns:
        Filtered DataFrame.
    """
    df = get_dataframe()
    return df[df[column] == value]


def group_by(column: str) -> pd.core.groupby.DataFrameGroupBy:
    """Return a GroupBy object on the specified column."""
    df = get_dataframe()
    return df.groupby(column)


def aggregate(column: str, operation: str) -> Any:
    """
    Apply a named aggregation to a column.

    Args:
        column:    Column to aggregate.
        operation: One of 'sum', 'mean', 'min', 'max', 'count', 'std'.

    Returns:
        Scalar aggregation result.
    """
    df = get_dataframe()
    ops = {
        "sum": df[column].sum,
        "mean": df[column].mean,
        "min": df[column].min,
        "max": df[column].max,
        "count": df[column].count,
        "std": df[column].std,
    }
    if operation not in ops:
        raise ValueError(f"Unknown operation '{operation}'. Choose from: {list(ops)}")
    return ops[operation]()


def execute_python(code: str) -> tuple[Any, str | None]:
    """
    Execute arbitrary pandas code against the global DataFrame.

    Args:
        code: Python expression or statements using variable `df`.

    Returns:
        (result, error_or_None)
    """
    df = get_dataframe()
    return execute_code(code, df)
