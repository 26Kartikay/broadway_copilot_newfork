#!/bin/bash
# Find your Cloud SQL instance

echo "🔍 Listing all Cloud SQL instances..."
gcloud sql instances list

echo ""
echo "📝 To get connection name, run:"
echo "   gcloud sql instances describe INSTANCE_NAME --format='value(connectionName)'"
echo ""
echo "Or check your DATABASE_URL secret:"
echo "   gcloud secrets versions access latest --secret='PRIVATE_DATABASE_URL'"

