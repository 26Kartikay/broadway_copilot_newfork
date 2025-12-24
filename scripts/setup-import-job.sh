#!/bin/bash
# Setup script for Cloud Run Job to import products
# This creates a Cloud Run Job that can be executed on-demand
# Note: This job requires a CSV file to be uploaded to Cloud Storage first

set -e

PROJECT_ID="broadway-chatbot"
REGION="asia-south2"
JOB_NAME="import-products"
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
echo ""
echo "⚠️  NOTE: This job requires a CSV file path to be provided when executing."
echo "   Upload your products.csv to Cloud Storage first, then execute with:"
echo "   gcloud run jobs execute $JOB_NAME --region=$REGION --args=\"--file=/path/to/products.csv\" --wait"
echo ""

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
  --args="dist/scripts/importProducts.js" \
  --project=$PROJECT_ID

echo ""
echo "✅ Cloud Run Job created successfully!"
echo ""
echo "⚠️  IMPORTANT: Cloud Run Jobs cannot access local files."
echo "   You have two options:"
echo ""
echo "   Option 1: Run from Cloud Shell (Recommended for imports)"
echo "   ========================================================="
echo "   1. Upload your CSV to Cloud Shell"
echo "   2. Export secrets:"
echo "      export DATABASE_URL=\$(gcloud secrets versions access latest --secret=\"PRIVATE_DATABASE_URL\")"
echo "      export OPENAI_API_KEY=\$(gcloud secrets versions access latest --secret=\"OPENAI_API_KEY\")"
echo "      export NODE_ENV=production"
echo "   3. Clone repo, install deps, and run:"
echo "      npx ts-node scripts/importProducts.ts --file=products.csv"
echo ""
echo "   Option 2: Use Cloud Storage (Advanced)"
echo "   ======================================"
echo "   1. Upload CSV to Cloud Storage bucket"
echo "   2. Mount bucket as volume in Cloud Run Job"
echo "   3. Execute job with file path"
echo ""

