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

# Prod/Docker images only ship dist/ (no src/). Dev uses ts-node + src/.
BULK_JS="$ROOT/dist/automation/scripts/bulkCatalogSync.js"
BULK_TS="$ROOT/src/automation/scripts/bulkCatalogSync.ts"
set +u
if [[ -f "$BULK_TS" ]]; then
  RUNNER=(npx ts-node --transpile-only "$BULK_TS")
else
  if [[ ! -f "$BULK_JS" ]]; then
    echo "bulkCatalogSync not found: expected $BULK_TS (dev) or $BULK_JS (run: npm run build)." >&2
    exit 1
  fi
  RUNNER=(node "$BULK_JS")
fi
set -u

# Omitting --seed/--tag/--embed with --csv enables all three steps (see bulkCatalogSync.ts).
exec "${RUNNER[@]}" \
  --csv "$CSV" \
  --mapping "$MAPPING" \
  --max "$MAX" \
  --concurrency "$CONCURRENCY" \
  "${EXTRA[@]}"
