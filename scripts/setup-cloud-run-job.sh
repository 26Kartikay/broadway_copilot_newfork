#!/bin/bash
# Setup script for Cloud Run Job to generate embeddings
# This creates a Cloud Run Job that can be executed on-demand

set -e

PROJECT_ID="broadway-chatbot"
REGION="asia-south2"
JOB_NAME="generate-embeddings"
SERVICE_NAME="broadway-chatbot"
SERVICE_ACCOUNT="github-actions-deploy@broadway-chatbot.iam.gserviceaccount.com"

echo "🔍 Getting latest image from Cloud Run service..."
IMAGE=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(spec.template.spec.containers[0].image)')

if [ -z "$IMAGE" ]; then
  echo "❌ Error: Could not get image from Cloud Run service $SERVICE_NAME"
  echo "   Make sure the service is deployed first."
  exit 1
fi

echo "📦 Using image: $IMAGE"
echo "🚀 Creating Cloud Run Job: $JOB_NAME"

gcloud run jobs create $JOB_NAME \
  --image=$IMAGE \
  --region=$REGION \
  --max-retries=1 \
  --service-account=$SERVICE_ACCOUNT \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="DATABASE_URL=PRIVATE_DATABASE_URL:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest" \
  --network=chatbot-vpc \
  --subnet=chatbot-subnet \
  --vpc-egress=private-ranges-only \
  --task-timeout=3600 \
  --memory=4Gi \
  --cpu=2 \
  --command="node" \
  --args="dist/scripts/generateEmbeddings.js" \
  --project=$PROJECT_ID

echo ""
echo "✅ Cloud Run Job created successfully!"
echo ""
echo "To execute the job, run:"
echo "  gcloud run jobs execute $JOB_NAME --region=$REGION --wait"
echo ""
echo "To view job logs:"
echo "  gcloud logging read \"resource.type=cloud_run_job AND resource.labels.job_name=$JOB_NAME\" --limit 50 --format json"

