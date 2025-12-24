#!/bin/bash
# Execute the Cloud Run Job to import products
# This requires a CSV file path to be provided

set -e

REGION="asia-south2"
JOB_NAME="import-products"

if [ -z "$1" ]; then
  echo "❌ Error: CSV file path required"
  echo ""
  echo "Usage: ./scripts/run-import-job.sh <path-to-csv-file> [--clear]"
  echo ""
  echo "Example:"
  echo "  ./scripts/run-import-job.sh gs://my-bucket/products.csv"
  echo "  ./scripts/run-import-job.sh /tmp/products.csv --clear"
  echo ""
  echo "⚠️  NOTE: Cloud Run Jobs cannot access local files directly."
  echo "   For local files, use Cloud Shell instead (see DEPLOYMENT_EMBEDDINGS.md)"
  exit 1
fi

CSV_FILE="$1"
CLEAR_FLAG="${2:-}"

ARGS="--file=$CSV_FILE"
if [ "$CLEAR_FLAG" == "--clear" ]; then
  ARGS="$ARGS --clear"
fi

echo "🚀 Executing Cloud Run Job: $JOB_NAME"
echo "📁 CSV File: $CSV_FILE"
if [ "$CLEAR_FLAG" == "--clear" ]; then
  echo "⚠️  WARNING: --clear flag enabled. All existing products will be deleted!"
fi
echo ""

gcloud run jobs execute $JOB_NAME \
  --region=$REGION \
  --args="$ARGS" \
  --wait

echo ""
echo "✅ Job execution completed!"
echo ""
echo "To view logs, run:"
echo "  gcloud logging read \"resource.type=cloud_run_job AND resource.labels.job_name=$JOB_NAME\" --limit 100 --format json"

