from fastapi import APIRouter, HTTPException
from api.models import AnalyzeRequest, AnalyzeResponse
from api.analytics_service import generate_insight

router = APIRouter()


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    if not req.rows:
        raise HTTPException(status_code=422, detail="No data to analyze")
    insight = generate_insight(req.question, req.columns, req.rows)
    return AnalyzeResponse(insight=insight)
