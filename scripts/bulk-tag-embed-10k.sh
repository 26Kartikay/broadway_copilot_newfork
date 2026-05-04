#!/usr/bin/env bash
# Bulk: seed from CSV → (optional OpenAI tagging) → embeddings for ~10k products.
# Same Product columns as runProductAutomation when BULK_LLM_TAGS=1 (uses tagExtractor + embeddings).
#
# Env:
#   BULK_CSV          default: files/products.csv
#   BULK_MAPPING      default: files/catalogTaxonomy.json (taxonomy + _bulkCatalog columnMap)
#   BULK_MAX          default: 10000  (cap per run; re-run to drain queue)
#   BULK_CONCURRENCY  default: 12
#   BULK_LLM_TAGS     default: 1  (set 0 for faster/cheaper: CSV-only tags + embed only)
#
# Requires: DATABASE_URL, OPENAI_API_KEY. No Broadway API for this script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CSV="${BULK_CSV:-files/products.csv}"
MAPPING="${BULK_MAPPING:-files/catalogTaxonomy.json}"
MAX="${BULK_MAX:-10000}"
CONCURRENCY="${BULK_CONCURRENCY:-12}"
LLM="${BULK_LLM_TAGS:-1}"

EXTRA=()
if [[ "$LLM" == "1" || "$LLM" == "true" ]]; then
  EXTRA+=(--llm-tags)
fi

# Omitting --seed/--tag/--embed with --csv enables all three steps (see bulkCatalogSync.ts).
exec npx ts-node --transpile-only src/automation/scripts/bulkCatalogSync.ts \
  --csv "$CSV" \
  --mapping "$MAPPING" \
  --max "$MAX" \
  --concurrency "$CONCURRENCY" \
  "${EXTRA[@]}"
