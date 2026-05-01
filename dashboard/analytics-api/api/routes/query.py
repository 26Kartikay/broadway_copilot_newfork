from fastapi import APIRouter, HTTPException
from starlette.requests import Request

from api.analytics_service import execute_query, generate_insight, nl_to_query
from api.db_context import bind_database, reset_database
from api.models import ChartConfig, QueryRequest, QueryResponse

router = APIRouter()


@router.post("/query", response_model=QueryResponse)
def run_query(request: Request, req: QueryRequest):
    token = bind_database(request, req.database_id)
    try:
        try:
            sql, chart_type, title, x_axis, y_axis, description = nl_to_query(
                req.question, model=req.model
            )
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

        if not sql:
            detail = (description or "").strip()
            if not detail:
                detail = "Could not generate SQL for this question"
            raise HTTPException(status_code=422, detail=detail)

        try:
            columns, rows, row_count = execute_query(sql)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        insight = (
            generate_insight(req.question, columns, rows, model=req.model) if rows else None
        )

        return QueryResponse(
            sql=sql,
            columns=columns,
            rows=rows,
            row_count=row_count,
            chart=ChartConfig(
                chart_type=chart_type,
                x_axis=x_axis,
                y_axis=y_axis,
                title=title,
                description=description,
            ),
            insight=insight,
        )
    finally:
        reset_database(token)


@router.post("/query/sql", response_model=QueryResponse)
def run_raw_sql(request: Request, body: dict):
    """Execute raw SQL directly (skips NL translation)."""
    sql = (body.get("sql") or "").strip()
    question = body.get("question", "Custom SQL query")
    if not sql:
        raise HTTPException(status_code=422, detail="sql field required")

    token = bind_database(request, body.get("database_id"))
    try:
        try:
            columns, rows, row_count = execute_query(sql)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        insight = (
            generate_insight(question, columns, rows, model=body.get("model")) if rows else None
        )

        return QueryResponse(
            sql=sql,
            columns=columns,
            rows=rows,
            row_count=row_count,
            chart=ChartConfig(
                chart_type="table",
                x_axis=columns[0] if columns else None,
                y_axis=columns[1] if len(columns) > 1 else None,
                title=question[:60],
                description="Raw SQL result",
            ),
            insight=insight,
        )
    finally:
        reset_database(token)
