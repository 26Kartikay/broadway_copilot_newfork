#!/bin/bash
# Connect to Cloud SQL using Cloud SQL Proxy
# This allows Cloud Shell to access private Cloud SQL instances

set -e

PROJECT_ID="broadway-chatbot"
INSTANCE_CONNECTION_NAME="${PROJECT_ID}:asia-south2:broadway-db"

echo "🔧 Setting up Cloud SQL Proxy..."
echo "Instance: $INSTANCE_CONNECTION_NAME"

# Download Cloud SQL Proxy if not exists
if [ ! -f cloud-sql-proxy ]; then
  echo "📥 Downloading Cloud SQL Proxy..."
  wget https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.linux.amd64 -O cloud-sql-proxy
  chmod +x cloud-sql-proxy
fi

# Start proxy in background
echo "🚀 Starting Cloud SQL Proxy on port 5432..."
./cloud-sql-proxy $INSTANCE_CONNECTION_NAME --port 5432 &
PROXY_PID=$!

# Wait for proxy to start
sleep 3

echo "✅ Cloud SQL Proxy started (PID: $PROXY_PID)"
echo "📝 Use DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE"
echo ""
echo "To stop the proxy, run: kill $PROXY_PID"
echo ""

# Keep script running
wait $PROXY_PID

