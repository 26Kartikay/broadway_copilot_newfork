from fastapi import APIRouter, HTTPException
from starlette.requests import Request

from api.analytics_service import get_schema_structured
from api.db_context import bind_database, reset_database
from api.models import ColumnMeta, SchemaResponse, TableSchema

router = APIRouter()


@router.get("/schema", response_model=SchemaResponse)
def get_schema(request: Request):
    token = bind_database(request)
    try:
        tables_raw = get_schema_structured()
        tables = [
            TableSchema(
                table=t["table"],
                columns=[ColumnMeta(name=c["name"], type=c["type"]) for c in t["columns"]],
            )
            for t in tables_raw
        ]
        return SchemaResponse(tables=tables)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        reset_database(token)
