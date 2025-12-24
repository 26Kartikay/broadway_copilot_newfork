# Running Embedding Generation in Production

The script has been configured to **only run in production** by default. It will refuse to run unless:
- `NODE_ENV=production` is set, OR
- `ALLOW_LOCAL_EMBEDDING_GENERATION=true` is explicitly set (for testing)

## Option 1: Run from Cloud Shell (Easiest)

```bash
# 1. Get production secrets
export DATABASE_URL=$(gcloud secrets versions access latest --secret="PRIVATE_DATABASE_URL")
export OPENAI_API_KEY=$(gcloud secrets versions access latest --secret="OPENAI_API_KEY")
export NODE_ENV=production

# 2. Clone your repo (if not already there)
git clone https://github.com/YOUR_ORG/broadway_copilot_newfork.git
cd broadway_copilot_newfork

# 3. Install dependencies
npm install --legacy-peer-deps

# 4. Generate Prisma client (use npm script to ensure correct version)
npm run prisma:generate

# 5. Run the script (will only work because NODE_ENV=production)
npx ts-node scripts/generateEmbeddings.ts
```

## Option 2: Create a Cloud Run Job (One-time Setup)

After the job is created, you can execute it anytime:

```bash
# Create the job (run once)
gcloud run jobs create generate-embeddings \
  --image asia-south2-docker.pkg.dev/broadway-chatbot/broadway-chatbot/broadway-chatbot:latest \
  --region asia-south2 \
  --task-timeout 3600 \
  --max-retries 1 \
  --task-service-account github-actions-deploy@broadway-chatbot.iam.gserviceaccount.com \
  --set-env-vars NODE_ENV=production \
  --set-secrets DATABASE_URL=PRIVATE_DATABASE_URL:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest \
  --vpc-network chatbot-vpc \
  --vpc-subnet chatbot-subnet \
  --vpc-egress private-ranges-only \
  --memory 4Gi \
  --cpu 2 \
  --command node \
  --args dist/scripts/generateEmbeddings.js

# Execute the job (can run anytime)
gcloud run jobs execute generate-embeddings --region asia-south2 --wait
```

**Note:** For the Cloud Run Job to work, the script needs to be compiled. Make sure `scripts/` folder is included in the TypeScript build (which we've now updated).

## Option 3: Run Locally (Testing Only)

If you want to test locally, you must explicitly allow it:

```bash
export ALLOW_LOCAL_EMBEDDING_GENERATION=true
export DATABASE_URL="your-local-db-url"
export OPENAI_API_KEY="your-api-key"
npx ts-node scripts/generateEmbeddings.ts
```

## Safety Features

- ✅ Script checks for `NODE_ENV=production` before running
- ✅ Prevents accidental runs on local/development databases
- ✅ Clear error messages if run in wrong environment
- ✅ Can be explicitly allowed for testing with `ALLOW_LOCAL_EMBEDDING_GENERATION=true`

