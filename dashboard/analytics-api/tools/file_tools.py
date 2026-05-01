"""
file_tools.py — Loading and inspecting multiple file types.
"""

from __future__ import annotations

import pandas as pd
from pathlib import Path
from typing import List, Dict, Any
from data_manager import manager


def open_file_tool(file_path: str, name: str = None) -> str:
    """
    Load a file (CSV, XLSX, JSON, Parquet) and store it in the session.

    Args:
        file_path: Path to the file.
        name:      Optional original filename to store it under.

    Returns:
        A confirmation message with column names and row count.
    """
    p = Path(file_path)
    if not p.exists():
        return f"Error: File '{file_path}' not found."

    suffix = p.suffix.lower()
    if name is None:
        name = p.name

    try:
        if suffix == ".csv":
            df = pd.read_csv(file_path)
        elif suffix in [".xlsx", ".xls"]:
            df = pd.read_excel(file_path)
        elif suffix == ".json":
            df = pd.read_json(file_path)
        elif suffix == ".parquet":
            df = pd.read_parquet(file_path)
        else:
            return f"Error: Unsupported file format '{suffix}'."

        # Basic cleaning of column names
        df.columns = df.columns.str.strip()
        manager.add_dataset(name, df)

        return f"Loaded '{name}' with {len(df)} rows and {len(df.columns)} columns."

    except Exception as e:
        return f"Error loading '{name}': {str(e)}"


def list_loaded_files_tool() -> str:
    """Returns all datasets currently loaded."""
    files = manager.list_datasets()
    if not files:
        return "No datasets loaded."
    
    output = "Loaded datasets:\n"
    for i, name in enumerate(files, 1):
        df = manager.get_dataset(name)
        output += f"{i}. {name} ({len(df)} rows, {len(df.columns)} columns)\n"
    return output


def inspect_dataset_tool(name: str) -> str:
    """Provides detailed metadata about a specific dataset."""
    ctx = manager.get_context(name)
    if not ctx:
        return f"Error: Dataset '{name}' not found."

    output = f"Dataset: {name}\n"
    output += f"Rows: {ctx.row_count}\n"
    output += f"Columns: {', '.join(ctx.column_names)}\n\n"
    output += "Column Types:\n"
    for col, dtype in ctx.column_types.items():
        missing = ctx.missing_counts.get(col, 0)
        unique = ctx.unique_counts.get(col, 0)
        output += f"  - {col}: {dtype} (Missing: {missing}, Unique: {unique})\n"
    
    output += "\nSample Rows:\n"
    df = manager.get_dataset(name)
    output += df.head(3).to_string()
    
    return output
