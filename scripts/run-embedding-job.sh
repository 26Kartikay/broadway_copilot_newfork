#!/bin/bash
# Execute the Cloud Run Job to generate embeddings
# This is a simple wrapper to execute the job and wait for completion

set -e

REGION="asia-south2"
JOB_NAME="generate-embeddings"

echo "🚀 Executing Cloud Run Job: $JOB_NAME"
echo "This will generate embeddings for all products without embeddings..."
echo ""

gcloud run jobs execute $JOB_NAME \
  --region=$REGION \
  --wait

echo ""
echo "✅ Job execution completed!"
echo ""
echo "To view logs, run:"
echo "  gcloud logging read \"resource.type=cloud_run_job AND resource.labels.job_name=$JOB_NAME\" --limit 100 --format json"

