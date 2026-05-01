"""
main.py — FastAPI application entry point for the Analytics Dashboard API.
"""

from __future__ import annotations

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import analyze, databases, query, schema

app = FastAPI(
    title="Broadway Analytics API",
    version="1.0.0",
    description="AI-powered analytics API — natural language to SQL to charts",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(databases.router, prefix="/api", tags=["databases"])
app.include_router(schema.router, prefix="/api", tags=["schema"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(analyze.router, prefix="/api", tags=["analyze"])


@app.get("/health")
def health():
    return {"status": "ok"}
