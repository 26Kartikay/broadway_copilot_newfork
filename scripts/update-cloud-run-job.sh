#!/bin/bash
# Update Cloud Run Job to use the latest image from the deployed service

set -e

PROJECT_ID="broadway-chatbot"
REGION="asia-south2"
JOB_NAME="generate-embeddings"
SERVICE_NAME="broadway-chatbot"

echo "🔍 Getting latest image from Cloud Run service..."
IMAGE=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(spec.template.spec.containers[0].image)')

if [ -z "$IMAGE" ]; then
  echo "❌ Error: Could not get image from Cloud Run service $SERVICE_NAME"
  echo "   Make sure the service is deployed first."
  exit 1
fi

echo "📦 Using image: $IMAGE"
echo "🔄 Updating Cloud Run Job: $JOB_NAME"

gcloud run jobs update $JOB_NAME \
  --image=$IMAGE \
  --region=$REGION \
  --project=$PROJECT_ID

echo ""
echo "✅ Cloud Run Job updated successfully!"
echo ""
echo "To execute the job, run:"
echo "  gcloud run jobs execute $JOB_NAME --region=$REGION --wait"

