"""
analytics_tools.py — Querying, joining, and engineering features across datasets.
"""

from __future__ import annotations

import pandas as pd
from typing import List, Dict, Any, Optional
from data_manager import manager
from executor import execute_code


def query_data_tool(name: str, query: str) -> str:
    """
    Perform a SQL-style query on a dataset.

    Args:
        name: Name of the dataset.
        query: Python expression or pandas query string.

    Returns:
        Result summary or preview rows.
    """
    df = manager.get_dataset(name)
    if df is None:
        return f"Error: Dataset '{name}' not found."

    try:
        # Use pandas query method for filtering
        result = df.query(query)
        return f"Query returned {len(result)} rows.\nPreview:\n{result.head(5).to_string()}"
    except Exception as e:
        return f"Query error: {str(e)}"


def aggregate_tool(name: str, group_by: List[str], target_col: str, operation: str) -> str:
    """
    Perform grouping and aggregations.

    Args:
        name: Name of the dataset.
        group_by: Column(s) to group by.
        target_col: Column to aggregate.
        operation: Aggregation operation (sum, mean, count, median).

    Returns:
        Aggregation result table.
    """
    df = manager.get_dataset(name)
    if df is None:
        return f"Error: Dataset '{name}' not found."

    try:
        agg_result = df.groupby(group_by)[target_col].agg(operation).reset_index()
        return agg_result.to_string()
    except Exception as e:
        return f"Aggregation error: {str(e)}"


def join_datasets_tool(left_name: str, right_name: str, left_on: str, right_on: str, how: str = 'inner') -> str:
    """
    Join two datasets on specified columns.

    Args:
        left_name: Left dataset name.
        right_name: Right dataset name.
        left_on: Join key for the left dataset.
        right_on: Join key for the right dataset.
        how: Join type (inner, left, right, outer).

    Returns:
        Success message with the name of the new dataset.
    """
    left_df = manager.get_dataset(left_name)
    right_df = manager.get_dataset(right_name)

    if left_df is None or right_df is None:
        return "Error: One or more datasets not found."

    try:
        new_df = pd.merge(left_df, right_df, left_on=left_on, right_on=right_on, how=how)
        new_name = f"joined_{left_name.split('.')[0]}_{right_name.split('.')[0]}"
        manager.add_dataset(new_name, new_df)
        return f"Successfully joined {left_name} and {right_name} into {new_name}. Result has {len(new_df)} rows."
    except Exception as e:
        return f"Join error: {str(e)}"


def feature_engineering_tool(name: str, expression: str, new_col: str) -> str:
    """
    Create derived features using an expression.

    Example:
    feature_engineering_tool("sales.csv", "revenue / customers", "revenue_per_customer")

    Args:
        name: Name of the dataset.
        expression: Python expression using column names.
        new_col: Name for the new column.

    Returns:
        Success or error message.
    """
    df = manager.get_dataset(name)
    if df is None:
        return f"Error: Dataset '{name}' not found."

    try:
        # Use eval for feature engineering
        df[new_col] = df.eval(expression)
        manager.add_dataset(name, df)
        return f"Successfully added column '{new_col}' to {name}."
    except Exception as e:
        return f"Feature engineering error: {str(e)}"
