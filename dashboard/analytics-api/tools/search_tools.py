"""
search_tools.py — Tools for searching across dataset and SQL schemas.
"""

from __future__ import annotations

import re
from typing import List, Dict, Any
import os
from sqlalchemy import inspect

from data_manager import manager
from tools.sql_tools import _get_db_connection

def search_columns(query: str) -> str:
    """
    Search for columns matching a query across all loaded datasets and SQL tables.
    
    Args:
        query: The search term (regex supported).
        
    Returns:
        A summary of matching columns and their locations.
    """
    results = []
    try:
        query_re = re.compile(query, re.IGNORECASE)
    except re.error:
        # Fallback to literal search if regex is invalid
        query_re = re.compile(re.escape(query), re.IGNORECASE)
    
    # 1. Search in-memory datasets
    for name in manager.list_datasets():
        ctx = manager.get_context(name)
        if ctx:
            matches = [col for col in ctx.column_names if query_re.search(col)]
            if matches:
                results.append(f"Dataset '{name}': {', '.join(matches)}")
                
    # 2. Search SQL database
    try:
        engine = _get_db_connection()
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        
        # Filter by accessible tables if configured
        accessible_tables_env = os.getenv('ACCESSIBLE_TABLES')
        if accessible_tables_env:
            allowed = {t.strip().lower() for t in accessible_tables_env.split(',')}
            tables = [t for t in tables if t.lower() in allowed]
            
        for table_name in tables:
            columns = [col['name'] for col in inspector.get_columns(table_name)]
            matches = [col for col in columns if query_re.search(col)]
            if matches:
                results.append(f"SQL Table '{table_name}': {', '.join(matches)}")
    except Exception as e:
        results.append(f"Error searching SQL database: {str(e)}")
        
    if not results:
        return f"No columns matching '{query}' found."
        
    return "Search Results:\n" + "\n".join(results)
