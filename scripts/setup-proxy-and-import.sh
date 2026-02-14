#!/bin/bash
# Setup Cloud SQL Proxy and import products
# This script helps you connect to private Cloud SQL from Cloud Shell

set -e

echo "🔍 Finding your Cloud SQL instance..."

# Try to get instance connection name from DATABASE_URL secret
DB_URL=$(gcloud secrets versions access latest --secret="PRIVATE_DATABASE_URL" 2>/dev/null || echo "")

if [ -z "$DB_URL" ]; then
  echo "❌ Could not get DATABASE_URL from secrets"
  echo "   Please provide your Cloud SQL instance connection name manually"
  echo "   Format: PROJECT_ID:REGION:INSTANCE_NAME"
  read -p "Enter connection name: " INSTANCE_CONNECTION
else
  # Extract connection name from DATABASE_URL
  # Format: postgresql://user:pass@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE
  INSTANCE_CONNECTION=$(echo $DB_URL | grep -oP '/cloudsql/\K[^/]+' || echo "")
  
  if [ -z "$INSTANCE_CONNECTION" ]; then
    echo "⚠️  Could not extract connection name from DATABASE_URL"
    echo "   DATABASE_URL format: $DB_URL"
    echo ""
    echo "   Please provide your Cloud SQL instance connection name manually"
    read -p "Enter connection name (PROJECT_ID:REGION:INSTANCE_NAME): " INSTANCE_CONNECTION
  fi
fi

echo "📦 Instance connection: $INSTANCE_CONNECTION"
echo ""

# Download Cloud SQL Proxy if not exists
if [ ! -f cloud-sql-proxy ]; then
  echo "📥 Downloading Cloud SQL Proxy..."
  wget https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.linux.amd64 -O cloud-sql-proxy
  chmod +x cloud-sql-proxy
  echo "✅ Cloud SQL Proxy downloaded"
fi

# Check if proxy is already running
if pgrep -f "cloud-sql-proxy.*5432" > /dev/null; then
  echo "✅ Cloud SQL Proxy is already running on port 5432"
  PROXY_PID=$(pgrep -f "cloud-sql-proxy.*5432" | head -1)
  echo "   PID: $PROXY_PID"
else
  echo "🚀 Starting Cloud SQL Proxy on port 5432..."
  ./cloud-sql-proxy $INSTANCE_CONNECTION --port 5432 > /tmp/cloud-sql-proxy.log 2>&1 &
  PROXY_PID=$!
  sleep 3
  
  if pgrep -P $PROXY_PID > /dev/null; then
    echo "✅ Cloud SQL Proxy started (PID: $PROXY_PID)"
  else
    echo "❌ Failed to start Cloud SQL Proxy"
    echo "   Check logs: cat /tmp/cloud-sql-proxy.log"
    exit 1
  fi
fi

echo ""
echo "📝 Now update your DATABASE_URL to use localhost:5432"
echo ""
echo "Get your database credentials and build connection string:"
echo ""
echo "  # Get credentials (adjust secret names as needed)"
echo "  DB_USER=\$(gcloud secrets versions access latest --secret='DB_USER' 2>/dev/null || echo 'postgres')"
echo "  DB_PASS=\$(gcloud secrets versions access latest --secret='DB_PASSWORD' 2>/dev/null || echo '')"
echo "  DB_NAME=\$(gcloud secrets versions access latest --secret='DB_NAME' 2>/dev/null || echo 'broadway')"
echo ""
echo "  # Build connection string using localhost (proxy)"
echo "  export DATABASE_URL=\"postgresql://\${DB_USER}:\${DB_PASS}@127.0.0.1:5432/\${DB_NAME}?schema=public\""
echo ""
echo "  # Get other secrets"
echo "  export OPENAI_API_KEY=\$(gcloud secrets versions access latest --secret='OPENAI_API_KEY')"
echo "  export NODE_ENV=production"
echo ""
echo "  # Now run your import"
echo "  npx ts-node scripts/importProducts.ts --file=products.csv"
echo ""
echo "To stop the proxy later, run: kill $PROXY_PID"






