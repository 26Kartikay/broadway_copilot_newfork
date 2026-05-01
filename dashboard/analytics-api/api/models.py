"""
models.py — Pydantic request/response models for the analytics API.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel


class QueryRequest(BaseModel):
    question: str
    model: Optional[str] = None
    database_id: Optional[str] = None


class DatabaseOption(BaseModel):
    id: str
    label: str


class DatabaseListResponse(BaseModel):
    databases: List[DatabaseOption]


class ColumnMeta(BaseModel):
    name: str
    type: str


class TableSchema(BaseModel):
    table: str
    columns: List[ColumnMeta]


class SchemaResponse(BaseModel):
    tables: List[TableSchema]


class ChartConfig(BaseModel):
    chart_type: str  # "bar" | "line" | "pie" | "scatter" | "table"
    x_axis: Optional[str] = None
    y_axis: Optional[str] = None
    title: str
    description: str


class QueryResponse(BaseModel):
    sql: str
    columns: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
    chart: ChartConfig
    insight: Optional[str] = None


class AnalyzeRequest(BaseModel):
    question: str
    sql: str
    columns: List[str]
    rows: List[Dict[str, Any]]


class AnalyzeResponse(BaseModel):
    insight: str


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
