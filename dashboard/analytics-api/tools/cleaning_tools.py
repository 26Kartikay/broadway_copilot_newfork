"""
cleaning_tools.py — Data cleaning using traditional and fuzzy matching.
"""

from __future__ import annotations

import pandas as pd
from typing import List, Dict, Any, Optional
from data_manager import manager
from rapidfuzz import process, fuzz


def clean_data_tool(name: str, operations: List[str]) -> str:
    """
    Perform multiple data cleaning operations on a dataset.

    Operations:
    - 'missing_drop': Remove rows with missing values.
    - 'missing_fill_mean': Fill numeric missing with mean.
    - 'duplicates_drop': Remove exact duplicate rows.
    - 'strip_whitespace': Strip whitespace from string columns.
    - 'numeric_conversion': Coerce columns with numeric-like values.
    - 'fuzzy_unify': Unify categorical values using fuzzy matching (e.g., "New Yrok" -> "New York").

    Args:
        name: Name of the dataset.
        operations: List of cleaning operations to perform.

    Returns:
        Summary of changes.
    """
    df = manager.get_dataset(name)
    if df is None:
        return f"Error: Dataset '{name}' not found."

    df_clean = df.copy()
    changes = []

    for op in operations:
        if op == "missing_drop":
            before = len(df_clean)
            df_clean = df_clean.dropna()
            after = len(df_clean)
            changes.append(f"Dropped {before - after} rows with missing values.")

        elif op == "missing_fill_mean":
            numeric_cols = df_clean.select_dtypes(include=['number']).columns
            for col in numeric_cols:
                mean_val = df_clean[col].mean()
                df_clean[col] = df_clean[col].fillna(mean_val)
            changes.append(f"Filled missing numeric values with column mean.")

        elif op == "duplicates_drop":
            before = len(df_clean)
            df_clean = df_clean.drop_duplicates()
            after = len(df_clean)
            changes.append(f"Dropped {before - after} duplicate rows.")

        elif op == "strip_whitespace":
            str_cols = df_clean.select_dtypes(include=['object']).columns
            for col in str_cols:
                df_clean[col] = df_clean[col].str.strip()
            changes.append("Stripped whitespace from all string columns.")

        elif op == "numeric_conversion":
            for col in df_clean.columns:
                converted = pd.to_numeric(df_clean[col], errors='coerce')
                # If at least 50% are converted successfully and it wasn't already numeric
                if converted.notna().mean() > 0.5 and not pd.api.types.is_numeric_dtype(df_clean[col]):
                    df_clean[col] = converted
                    changes.append(f"Converted '{col}' to numeric.")

        elif op.startswith("fuzzy_unify:"):
            # Format: "fuzzy_unify:column_name"
            _, col = op.split(":", 1)
            if col in df_clean.columns:
                unique_vals = df_clean[col].dropna().unique().tolist()
                for val in unique_vals:
                    # Find similar values (threshold 85)
                    matches = process.extract(val, unique_vals, scorer=fuzz.WRatio, score_cutoff=85, limit=5)
                    # matches are (string, score, index)
                    for match_str, score, _ in matches:
                        if match_str != val:
                            # Prefer the value with higher frequency or shorter length?
                            # For simplicity, we'll replace matches with the first encountered canonical value.
                            df_clean[col] = df_clean[col].replace(match_str, val)
                changes.append(f"Performed fuzzy unification on '{col}'.")

    # Update the dataset in manager
    manager.add_dataset(name, df_clean)
    return "Cleaning complete.\n" + "\n".join(changes)
