"""
ai_inference.py — AI-powered dataset analysis and insight generation.
"""

from __future__ import annotations

import json
from typing import List, Dict, Any, Optional
from data_manager import manager
from llm_utils import generate_with_ollama


def detect_relationships_tool() -> str:
    """Detect relationships and potential join keys between all loaded datasets."""
    datasets = manager.list_datasets()
    if len(datasets) < 2:
        return "Not enough datasets to detect relationships."

    contexts = {name: manager.get_context(name).model_dump() for name in datasets}
    
    prompt = (
        "You are a data architect.\n"
        "Given the following dataset metadata (JSON), detect potential relationships and join keys between them.\n"
        "Look for similar column names and semantic overlaps (e.g., 'customer_id' and 'CID').\n"
        "Suggest specific joins that would be useful for analysis.\n\n"
        f"Datasets:\n{json.dumps(contexts, indent=2, default=str)}\n\n"
        "Return a concise summary of detected relationships."
    )
    
    return generate_with_ollama(prompt, system="Reply as a technical architect.")


def insight_generation_tool(name: str) -> str:
    """Generate business insights from a dataset using AI inference."""
    ctx = manager.get_context(name)
    if not ctx:
        return f"Error: Dataset '{name}' not found."

    prompt = (
        "You are an AI data analyst.\n"
        "Given the following dataset summary, identify 3-5 key business insights or trends.\n"
        "Look for correlations, anomalies, and patterns.\n\n"
        f"Dataset Summary ({name}):\n{json.dumps(ctx.model_dump(), indent=2, default=str)}\n\n"
        "Provide specific, actionable insights."
    )
    
    return generate_with_ollama(prompt, system="Reply as a senior business analyst.")


def semantic_cleaning_suggestion_tool(name: str) -> str:
    """Detect data quality issues and suggest cleaning steps."""
    ctx = manager.get_context(name)
    if not ctx:
        return f"Error: Dataset '{name}' not found."

    prompt = (
        "You are an AI data engineer.\n"
        "Analyze this dataset metadata for quality issues like:\n"
        "- Mislabeled fields\n"
        "- Inconsistent values\n"
        "- Semantic type mismatches\n"
        "- Missing data patterns\n\n"
        f"Dataset Metadata ({name}):\n{json.dumps(ctx.model_dump(), indent=2, default=str)}\n\n"
        "Suggest cleaning operations (including fuzzy matching if needed)."
    )
    
    return generate_with_ollama(prompt, system="Reply as a senior data engineer.")
