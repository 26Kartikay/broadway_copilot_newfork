from fastapi import APIRouter

from api.database_registry import registry
from api.models import DatabaseListResponse, DatabaseOption

router = APIRouter()


@router.get("/databases", response_model=DatabaseListResponse)
def list_databases():
    opts = [DatabaseOption(**row) for row in registry.list_public()]
    return DatabaseListResponse(databases=opts)
