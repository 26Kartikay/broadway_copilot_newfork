"""
main.py — CLI entry point for the AI-powered Data Engineering & Analytics Agent.
"""

from __future__ import annotations

import sys
import subprocess
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

from agent import AnalyticsAgent
from data_manager import manager
from tools.file_tools import open_file_tool


# ── ANSI colour helpers ───────────────────────────────────────────────────────

def _c(text: str, code: str) -> str:
    if not sys.stdout.isatty():
        return text
    return f"\033[{code}m{text}\033[0m"


BOLD = lambda t: _c(t, "1")
GREEN = lambda t: _c(t, "32")
CYAN = lambda t: _c(t, "36")
YELLOW = lambda t: _c(t, "33")
RED = lambda t: _c(t, "31")
DIM = lambda t: _c(t, "2")


# ── Banner ───────────────────────────────────────────────────────────────────

def _banner():
    print(BOLD(CYAN("\n╔════════════════════════════════════════════════════╗")))
    print(BOLD(CYAN("║   AI Data Engineering & Analytics Agent  v2.0     ║")))
    print(BOLD(CYAN("╚════════════════════════════════════════════════════╝\n")))


# ── macOS Native File Picker ─────────────────────────────────────────────────

def _mac_file_picker() -> str | None:
    """Uses macOS native Finder file picker to select one or more files."""
    script = (
        'set theFiles to choose file with prompt "Select data files (CSV, Excel, JSON, Parquet)" '
        'with multiple selections allowed\n'
        'set thePaths to {}\n'
        'repeat with aFile in theFiles\n'
        '    set end of thePaths to POSIX path of aFile\n'
        'end repeat\n'
        'set AppleScript\'s text item delimiters to "|||"\n'
        'return thePaths as string'
    )
    
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            return result.stdout.strip()

    except Exception:
        pass

    return None


# ── File Handling ────────────────────────────────────────────────────────────

def _handle_file_upload():
    """Prompt the user for file paths and load them."""
    print(DIM("\n  (Opening file picker...)"))
    
    # Try macOS picker
    if sys.platform == "darwin":
        raw_paths = _mac_file_picker()
        if raw_paths:
            # osascript returns a list of paths joined by "|||"
            paths = [p.strip() for p in raw_paths.split("|||")]
            for p in paths:
                if p:
                    msg = open_file_tool(p)
                    print(GREEN(f"  ✔ {msg}"))
            return

    # Fallback manual entry
    print(BOLD("\n📂 Falling back to manual path entry."))
    while True:
        raw = input(BOLD("📂 Enter path to a file (or 'done' to finish): ")).strip()
        if raw.lower() == "done":
            break
        if not raw:
            continue
        
        p = Path(raw)
        if p.exists():
            msg = open_file_tool(str(p))
            print(GREEN(f"  ✔ {msg}"))
        else:
            print(RED(f"  ✗ '{raw}' not found."))


# ── Main Runner ──────────────────────────────────────────────────────────────

def run():
    _banner()
    agent = AnalyticsAgent()

    print(BOLD("── Initial Setup ───────────────────────"))
    print("How would you like to start?")
    print("  1. " + BOLD("Connect to Database") + " (from .env)")
    print("  2. " + BOLD("Load Data Files") + " (CSV, Excel, etc.)")
    print("  3. " + BOLD("Both") + " (Use DB and load additional files)")
    print()

    choice = ""
    while choice not in ["1", "2", "3"]:
        choice = input(BOLD("Choice (1-3): ")).strip()

    if choice in ["1", "3"]:
        print(YELLOW("\n⏳ Initializing database connection..."))
        from tools.sql_tools import get_sql_schema_tool
        schema = get_sql_schema_tool()
        if "Error" in schema or "No accessible tables" in schema:
            print(RED(f"  ✗ Database connection failed or no tables found."))
            print(DIM(f"    {schema}"))
        else:
            print(GREEN("  ✔ Database connected successfully."))
            print(DIM("    Accessible tables found and indexed."))

    if choice in ["2", "3"]:
        _handle_file_upload()

    # Initial analysis if anything is loaded/connected
    print(YELLOW("\n⏳ Performing initial environment analysis..."))
    analysis = agent.initial_analysis()
    print(BOLD("\n── Analysis Summary ────────────────────"))
    print(analysis)
    print()

    print(BOLD("── Ready ───────────────────────────────"))
    print(DIM("  What analysis should we perform next?\n"))

    while True:
        try:
            user_input = input(BOLD("❓ You: ")).strip()
        except (EOFError, KeyboardInterrupt):
            break

        if not user_input:
            continue

        if user_input.lower() in {"exit", "quit", "q"}:
            break
            
        # Command: Load files explicitly
        # More specific keywords to avoid intercepting database "load" requests
        if any(cmd in user_input.lower() for cmd in ["upload file", "open file", "add dataset", "/load"]):
            _handle_file_upload()
            
            # If files were just loaded, do an initial analysis
            if manager.list_datasets():
                print(YELLOW("\n⏳ Analyzing datasets…"))
                analysis = agent.initial_analysis()
                print(BOLD("\n── Dataset Analysis ────────────────────"))
                print(analysis)
                print()
            continue

        # Regular interaction
        print(YELLOW("\n⏳ Thinking…"))
        response = agent.process_input(user_input)
        
        # Check for special file request signal
        if "[REQUEST_FILES]" in response:
            response = response.replace("[REQUEST_FILES]", "").strip()
            print(BOLD("\n── Agent ───────────────────────────────"))
            print(response)
            _handle_file_upload()
            
            if manager.list_datasets():
                print(YELLOW("\n⏳ Analyzing datasets…"))
                analysis = agent.initial_analysis()
                print(BOLD("\n── Dataset Analysis ────────────────────"))
                print(analysis)
        else:
            print(BOLD("\n── Agent ───────────────────────────────"))
            print(response)
        print()

    print(BOLD(CYAN("\nGoodbye! 👋\n")))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--ui":
        rc = subprocess.call(
            [sys.executable, "-m", "streamlit", "run", str(Path(__file__).resolve().parent / "streamlit_app.py")]
        )
        raise SystemExit(rc)
    run()
