"""
agent.py — Orchestrates context, tool usage, and the analytics workflow.
"""

from __future__ import annotations

import re
import json
from typing import Any, List, Dict, Optional

from data_manager import manager
from executor import execute_code
from llm_utils import (
    generate_with_ollama,
    get_db_dialect_sql_guidance,
    is_openai_configured,
    openai_chat,
    MAX_EXEC_RETRIES,
)

# Tool imports
from tools.file_tools import open_file_tool, list_loaded_files_tool, inspect_dataset_tool
from tools.cleaning_tools import clean_data_tool
from tools.analytics_tools import query_data_tool, aggregate_tool, join_datasets_tool, feature_engineering_tool
from tools.visualization_tools import (
    visualization_tool,
    visualization_from_dataframe_tool,
    visualization_from_sql_tool,
)
from tools.ai_inference import detect_relationships_tool, insight_generation_tool, semantic_cleaning_suggestion_tool
from tools.sql_tools import get_sql_schema_tool, execute_sql_query_tool
from tools.formatting import format_analysis_section
from tools.search_tools import search_columns


# ── System Prompts ────────────────────────────────────────────────────────────

PLANNER_SYSTEM_PROMPT = (
    "You are the Lead Data Architect. Your job is to analyze the user's request and create a technical plan.\n"
    "You have access to a Data Context Layer containing schemas and statistics.\n\n"
    "Your tasks:\n"
    "1. Identify relevant columns explicitly from the schema.\n"
    "2. Classify the analysis type (e.g., Trend Analysis, Correlation, Data Cleaning, etc.).\n"
    "3. Generate a step-by-step technical plan.\n"
    "4. Choose the best tools for each step:\n"
    "   - search_columns(query): If you need to explore the schema more.\n"
    "   - execute_sql_query_tool(query): ONLY for tables listed under 'SQL Database Schema'.\n"
    "   - Python Code: For 'In-Memory Datasets' (Pandas), complex logic, or custom stats.\n"
    "   - visualization_*_tool: For creating charts.\n\n"
    "SQL Rules:\n"
    "- NEVER use backticks (`) for identifiers. Use double quotes (\") if needed for names with spaces.\n"
    "- Use standard SQL syntax compatible with the dialect provided.\n\n"
    "Output format:\n"
    "REASONING: <brief reasoning>\n"
    "COLUMNS: <list of tables and columns>\n"
    "ANALYSIS_TYPE: <type>\n"
    "PLAN:\n"
    "1. <step 1> (Tool: <tool>)\n"
    "2. <step 2> (Tool: <tool>)\n"
    "...\n"
)

CODER_SYSTEM_PROMPT = (
    "You are Qwen Coder, an expert Python developer specialized in data science.\n"
    "Generate clean, efficient Python code using pandas and the provided tools.\n\n"
    "Data Access:\n"
    "- Datasets are ALREADY loaded in memory. DO NOT use `pd.read_csv` or `pd.read_excel` on local files.\n"
    "- Access datasets using their cleaned names (spaces and dots replaced by '_') or via the `datasets` dictionary.\n"
    "- Example: If 'data.csv' is loaded, use the variable `data_csv` or `datasets['data.csv']`.\n\n"
    "Tool Signatures:\n"
    "- `execute_sql_query_tool(query: str) -> str`: Executes SQL on the DB (NOT on in-memory files). Returns a string result.\n"
    "- `format_analysis_section(title: str, body: str) -> str`: Formats a section for the report. Requires BOTH title and body strings.\n"
    "- `visualization_from_dataframe_tool(df: pd.DataFrame, chart_type: str, x: str = None, y: str = None, hue: str = None, title: str = None) -> str`: Saves a chart from a DataFrame. `chart_type` can be 'bar', 'line', 'hist', 'scatter', or 'heatmap'.\n"
    "- `visualization_tool(name: str, chart_type: str, x: str = None, y: str = None, hue: str = None, title: str = None) -> str`: Saves a chart from a named dataset.\n\n"
    "CRITICAL:\n"
    "- You MUST set the final summary or result to the variable `result`.\n"
    "- If you use a tool, make sure you pass the correct number of arguments.\n"
    "- Only output the code within a ```python ``` block. No other text.\n"
)

REFLECTION_SYSTEM_PROMPT = (
    "You are a Senior Data Analyst. Review the user's original query and the results obtained so far.\n"
    "Determine if the query has been fully solved.\n\n"
    "If solved:\n"
    "- Provide a final comprehensive explanation of the findings.\n"
    "- State 'STATUS: SOLVED' at the end.\n\n"
    "If not solved:\n"
    "- Identify what is missing or what went wrong (e.g., empty results, errors).\n"
    "- Propose a refinement to the plan for the next iteration.\n"
    "- State 'STATUS: CONTINUE' at the end.\n\n"
    "Include a summary of the results (tables, chart paths) in your final explanation.\n"
)

EXECUTION_SPEC_PROMPT = (
    "You turn a plan step into an execution spec for a code generator.\n"
    "Output only the core logic or SQL needed for this specific step.\n"
    "IMPORTANT: NEVER use backticks (`) in SQL queries. Use double quotes (\") for identifiers with spaces.\n"
)


def _tool_output_failed(s: Any) -> bool:
    if s is None:
        return False
    t = str(s)
    return (
        "SQL query execution error" in t
        or "Query rejected:" in t
        or "Security check failed:" in t
    )


class AnalyticsAgent:
    """The central orchestrator for data analytics tasks using an iterative agent loop."""

    def __init__(self) -> None:
        self.session_history: List[Dict[str, str]] = []
        self.max_iterations = 3

    def _tools_globals(self) -> dict[str, Any]:
        return {
            "manager": manager,
            "open_file_tool": open_file_tool,
            "list_loaded_files_tool": list_loaded_files_tool,
            "inspect_dataset_tool": inspect_dataset_tool,
            "clean_data_tool": clean_data_tool,
            "query_data_tool": query_data_tool,
            "aggregate_tool": aggregate_tool,
            "join_datasets_tool": join_datasets_tool,
            "feature_engineering_tool": feature_engineering_tool,
            "visualization_tool": visualization_tool,
            "visualization_from_dataframe_tool": visualization_from_dataframe_tool,
            "visualization_from_sql_tool": visualization_from_sql_tool,
            "detect_relationships_tool": detect_relationships_tool,
            "insight_generation_tool": insight_generation_tool,
            "semantic_cleaning_suggestion_tool": semantic_cleaning_suggestion_tool,
            "get_sql_schema_tool": get_sql_schema_tool,
            "execute_sql_query_tool": execute_sql_query_tool,
            "format_analysis_section": format_analysis_section,
            "search_columns": search_columns,
        }

    def _get_data_context(self) -> str:
        """Extracts schema, sample rows and statistics for all available data."""
        files = manager.list_datasets()
        ctx = "Data Context Layer:\n"
        
        # 1. File-based datasets
        if files:
            ctx += "--- In-Memory Datasets ---\n"
            for f in files:
                ds_ctx = manager.get_context(f)
                ctx += f"Dataset '{f}':\n"
                ctx += f"  Columns: {ds_ctx.column_names}\n"
                ctx += f"  Types: {ds_ctx.column_types}\n"
                ctx += f"  Sample: {json.dumps(ds_ctx.sample_rows, default=str)}\n"
                ctx += f"  Stats: {json.dumps(ds_ctx.summary_statistics, default=str)}\n\n"
                
        # 2. SQL Schema
        sql_schema = get_sql_schema_tool()
        if "Error" not in sql_schema and "No accessible tables" not in sql_schema:
            ctx += "--- SQL Database Schema ---\n"
            ctx += sql_schema + "\n"
        else:
            ctx += "--- No SQL database configured or accessible ---\n"
            
        return ctx

    def process_input(self, user_input: str) -> str:
        """Main iterative agent loop."""
        
        iteration_results = []
        current_context = self._get_data_context()
        dialect = get_db_dialect_sql_guidance()
        
        full_output = """
── Agent Reasoning ──────────────────────────────────────
"""
        
        for i in range(self.max_iterations):
            step_header = f"\n── Iteration {i+1} ──────────────────────────────────────\n"
            full_output += step_header
            
            # 1. Planning Step (GPT-4o preferred)
            planner_input = (
                f"User Request: {user_input}\n\n"
                f"{current_context}\n\n"
                f"SQL Dialect: {dialect}\n\n"
                f"Previous Results: {iteration_results}\n"
            )
            
            if is_openai_configured():
                plan_raw = openai_chat(PLANNER_SYSTEM_PROMPT, planner_input, model="gpt-4o", temperature=0.1)
            else:
                plan_raw = generate_with_ollama(planner_input, system=PLANNER_SYSTEM_PROMPT)
                
            if not plan_raw or not plan_raw.strip():
                full_output += "Planner failed to generate a plan. Terminating iteration.\n"
                break
                
            full_output += f"Planner: {plan_raw}\n"
            
            # 2. Execution Step
            execution_log = self._execute_plan(plan_raw, user_input, dialect)
            full_output += f"\nExecution Results:\n{execution_log}\n"
            
            iteration_results.append({
                "iteration": i + 1,
                "plan": plan_raw,
                "results": execution_log
            })
            
            # 3. Reflection Step (GPT-4o preferred)
            reflection_input = (
                f"User Query: {user_input}\n\n"
                f"Iteration Log: {json.dumps(iteration_results, indent=2, default=str)}\n"
            )
            
            if is_openai_configured():
                reflection_raw = openai_chat(REFLECTION_SYSTEM_PROMPT, reflection_input, model="gpt-4o", temperature=0.1)
            else:
                reflection_raw = generate_with_ollama(reflection_input, system=REFLECTION_SYSTEM_PROMPT)
                
            full_output += f"\nReflection: {reflection_raw}\n"
            
            if "STATUS: SOLVED" in reflection_raw:
                break
                
        return full_output

    def _execute_plan(self, plan_raw: str, original_query: str, dialect: str) -> str:
        """Executes the steps in the plan."""
        steps = re.findall(r"(\d+\..*?\(Tool:.*?\))", plan_raw, re.DOTALL)
        if not steps:
            # Fallback if plan format is slightly different
            steps = plan_raw.split("PLAN:")[-1].strip().split("\n")
            
        results = []
        
        for step in steps:
            step = step.strip()
            if not step: continue
            
            if "Tool: search_columns" in step:
                query = re.search(r"search_columns\((.*?)\)", step)
                if query:
                    results.append(search_columns(query.group(1).strip("'\"")))
            
            elif "Tool: execute_sql_query_tool" in step:
                # Generate specific SQL for this step (GPT-4o preferred)
                sql_prompt = f"Step: {step}\nDialect: {dialect}\nContext: {original_query}"
                if is_openai_configured():
                    sql_query = openai_chat(EXECUTION_SPEC_PROMPT, sql_prompt, model="gpt-4o", temperature=0)
                else:
                    sql_query = generate_with_ollama(sql_prompt, system=EXECUTION_SPEC_PROMPT)
                
                # Extract SQL if model wrapped it in code blocks
                sql_clean = re.sub(r"```sql\n?|```", "", sql_query).strip()
                results.append(f"SQL Result for '{step}':\n" + execute_sql_query_tool(sql_clean))
                
            elif "Tool: Python Code" in step or "Tool: visualization" in step:
                # Use Qwen to generate Python code
                coder_prompt = (
                    f"Task: {step}\n"
                    f"Context: {original_query}\n"
                    f"Datasets: {list(manager.datasets.keys())}\n"
                    f"SQL Dialect: {dialect}\n"
                    "Available Tools: visualization_tool, visualization_from_sql_tool, visualization_from_dataframe_tool, execute_sql_query_tool, format_analysis_section\n"
                )
                code_raw = generate_with_ollama(coder_prompt, system=CODER_SYSTEM_PROMPT)
                code = self._extract_code(code_raw)
                
                res, error = execute_code(code, manager.datasets, extra_globals=self._tools_globals())
                if error:
                    results.append(f"Python Error in step '{step}': {error}")
                else:
                    results.append(f"Python Result for '{step}': {res}")
                    
            else:
                # General fallback for other tools or poorly defined steps
                results.append(f"Skipped unknown tool for step: {step}")
                
        return "\n---\n".join(str(r) for r in results)

    def _extract_code(self, raw: str) -> str:
        fenced = re.search(r"```(?:python)?\n?(.*?)```", raw, re.DOTALL)
        if fenced:
            return fenced.group(1).strip()
        return raw.strip()

    def initial_analysis(self) -> str:
        """Perform automatic analysis of all loaded files and databases."""
        files = manager.list_datasets()
        sql_schema = get_sql_schema_tool()
        
        if not files and ("Error" in sql_schema or "No accessible tables" in sql_schema):
            return "No files loaded and no SQL database accessible to analyze."

        summary = list_loaded_files_tool()
        relationships = detect_relationships_tool()
        
        prompt = (
            "I have performed an initial analysis of the environment.\n"
            f"Loaded File Datasets:\n{summary}\n\n"
            f"SQL Database Schema:\n{sql_schema}\n\n"
            f"Detected File Relationships:\n{relationships}\n\n"
            "Present this to the user professionally. Mention what's available and ask what analysis or cleaning they'd like to perform."
        )
        
        return generate_with_ollama(prompt, system="You are a professional Data Agent.")
