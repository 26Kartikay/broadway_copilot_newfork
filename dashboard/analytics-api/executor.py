"""
executor.py — Safe code execution sandbox for AI-generated pandas snippets.
"""

from __future__ import annotations

import builtins
import re
import traceback
import ast
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from typing import Any


# Patterns considered dangerous — blocked before execution
_BLOCKED_PATTERNS: list[str] = [
    r"\bos\b",
    r"\bsubprocess\b",
    r"\bopen\b",
    r"\b__import__\b",
    r"\beval\b",
    r"\bexec\b",
    r"\bshutil\b",
    r"\bsocket\b",
    r"\brequests\b",
    r"\bimportlib\b",
]

# Top-level module names the user snippet may import (transitive imports use real __import__)
_ALLOWED_IMPORT_ROOTS: frozenset[str] = frozenset(
    {
        "pandas",
        "matplotlib",
        "seaborn",
        "numpy",
        "math",
        "json",
        "re",
        "datetime",
        "collections",
        "itertools",
        "functools",
        "operator",
        "statistics",
        "decimal",
        "fractions",
        "typing",
    }
)


def _import_roots_from_stmt(node: ast.Import | ast.ImportFrom) -> list[str]:
    roots: list[str] = []
    if isinstance(node, ast.Import):
        for alias in node.names:
            roots.append(alias.name.split(".")[0])
    else:
        if node.level != 0:
            return ["<relative>"]
        if node.module:
            roots.append(node.module.split(".")[0])
        else:
            roots.append("<missing_module>")
    return roots


def _validate_user_imports(tree: ast.AST) -> tuple[bool, str]:
    """Ensure Import / ImportFrom in user code only touch allowlisted top-level modules."""
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for root in _import_roots_from_stmt(node):
                if root == "<relative>":
                    return False, "Relative imports are not allowed"
                if root == "<missing_module>":
                    return False, "Invalid import statement"
                if root not in _ALLOWED_IMPORT_ROOTS:
                    return False, f"Unauthorized import: '{root}'"
    return True, ""


def _is_safe(code: str) -> tuple[bool, str]:
    """
    Check generated code for blocked patterns and allowed imports (AST).

    Args:
        code: Python source string to inspect.

    Returns:
        (is_safe, reason) — reason is empty string when safe.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"Syntax error: {e}"

    ok, reason = _validate_user_imports(tree)
    if not ok:
        return False, reason

    for pattern in _BLOCKED_PATTERNS:
        if re.search(pattern, code):
            return False, f"Blocked pattern detected: '{pattern}'"
    return True, ""


def execute_code(code: str, datasets: dict[str, pd.DataFrame], extra_globals: dict[str, Any] = None) -> tuple[Any, str | None]:
    """
    Execute a pandas code snippet in a restricted environment.

    Args:
        code:          Python expression or statements that operate on datasets.
        datasets:      Map of dataset names to DataFrames.
        extra_globals: Optional dictionary of additional global variables to provide.

    Returns:
        (result, error) — result is the evaluated value; error is None on success.
    """
    safe, reason = _is_safe(code)
    if not safe:
        return None, f"Security check failed: {reason}"

    restricted_globals: dict[str, Any] = {
        "__builtins__": {
            "print": print,
            "len": len,
            "range": range,
            "enumerate": enumerate,
            "zip": zip,
            "list": list,
            "dict": dict,
            "str": str,
            "int": int,
            "float": float,
            "bool": bool,
            "round": round,
            "sorted": sorted,
            "sum": sum,
            "min": min,
            "max": max,
            "abs": abs,
            "isinstance": isinstance,
            "type": type,
            # Required for any `import` in user code; also used by library transitive imports.
            "__import__": builtins.__import__,
        },
        "pd": pd,
        "pandas": pd,
        "plt": plt,
        "sns": sns,
    }

    if extra_globals:
        restricted_globals.update(extra_globals)

    # Inject datasets into globals
    restricted_globals["datasets"] = datasets
    for name, df in datasets.items():
        # Clean name: replace all non-alphanumeric characters with '_'
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", name)
        # Ensure it doesn't start with a digit
        if safe_name[0].isdigit():
            safe_name = "_" + safe_name
        restricted_globals[safe_name] = df
        # Also provide 'df' for backward compatibility if only one dataset exists
        if len(datasets) == 1:
            restricted_globals["df"] = df

    local_ns: dict[str, Any] = {}

    try:
        # 1. Parse the code into an AST
        tree = ast.parse(code)

        # 2. If the last statement is an expression, we can evaluate it to get a result
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            # Split into: all but last statement, and the last statement
            last_expr = tree.body.pop()
            
            # Exec the first N-1 statements
            if tree.body:
                exec(compile(tree, "<string>", "exec"), restricted_globals, local_ns)
            
            # Eval the last statement
            # We must compile the Expression node specifically
            expr_code = compile(ast.Expression(last_expr.value), "<string>", "eval")
            result = eval(expr_code, restricted_globals, local_ns)
            return result, None
        else:
            # Otherwise just exec everything
            exec(code, restricted_globals, local_ns)
            result = local_ns.get("result", None)
            return result, None

    except Exception:
        return None, traceback.format_exc()
