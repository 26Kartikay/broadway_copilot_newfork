# Running Embedding Generation in Production

## Option 1: Run from Cloud Shell (Recommended)

Since you're already in Cloud Shell, follow these steps:

### Step 1: Get your secrets from Google Secret Manager

```bash
# Get DATABASE_URL (private connection string)
export DATABASE_URL=$(gcloud secrets versions access latest --secret="PRIVATE_DATABASE_URL")

# Get OPENAI_API_KEY
export OPENAI_API_KEY=$(gcloud secrets versions access latest --secret="OPENAI_API_KEY")
```

### Step 2: Clone or download your code

```bash
# If your repo is on GitHub
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# OR if you just need the script, you can download it directly
# (we'll provide an alternative below)
```

### Step 3: Install dependencies

```bash
# Install Node.js 22 if not already installed
# Cloud Shell usually has Node.js, check version:
node --version

# If needed, install Node 22:
# (Cloud Shell instructions may vary)

# Install dependencies
npm install --legacy-peer-deps
```

### Step 4: Generate Prisma Client

```bash
npx prisma generate
```

### Step 5: Run the embedding generation script

```bash
npx ts-node scripts/generateEmbeddings.ts
```

## Option 2: Quick Run (If you just want to run the script without cloning)

If you don't want to clone the entire repo, you can:

1. Create the script file directly in Cloud Shell
2. Copy the script content
3. Run it directly

But Option 1 is cleaner.

## Option 3: Use Cloud Run Jobs (Recommended for Production)

Cloud Run Jobs are perfect for one-off tasks like generating embeddings. Once set up, you can execute them anytime with a single command.

### Initial Setup (One-time)

**Step 1: Make sure your code is deployed**

The Cloud Run Job uses the same Docker image as your main service, so make sure you've pushed and deployed your code first.

**Step 2: Get the latest image tag from your Cloud Run service**

First, get the image that's currently deployed to your Cloud Run service:

```bash
IMAGE=$(gcloud run services describe broadway-chatbot --region asia-south2 --format='value(spec.template.spec.containers[0].image)')
echo $IMAGE
```

**Step 3: Create the Cloud Run Job**

```bash
# Make the setup script executable (it will automatically get the latest image)
chmod +x scripts/setup-cloud-run-job.sh
./scripts/setup-cloud-run-job.sh
```

Or manually create it (using the IMAGE variable from step 2):

```bash
# First, get the latest deployed image
IMAGE=$(gcloud run services describe broadway-chatbot --region asia-south2 --format='value(spec.template.spec.containers[0].image)')

# Then create the job
gcloud run jobs create generate-embeddings \
  --image $IMAGE \
  --region asia-south2 \
  --task-timeout 3600 \
  --max-retries 1 \
  --service-account github-actions-deploy@broadway-chatbot.iam.gserviceaccount.com \
  --set-env-vars NODE_ENV=production \
  --set-secrets DATABASE_URL=PRIVATE_DATABASE_URL:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest \
  --network chatbot-vpc \
  --subnet chatbot-subnet \
  --vpc-egress private-ranges-only \
  --memory 4Gi \
  --cpu 2 \
  --command node \
  --args dist/scripts/generateEmbeddings.js
```

### Execute the Job (Anytime)

After setup, you can run the embedding generation anytime:

```bash
# Using the helper script
chmod +x scripts/run-embedding-job.sh
./scripts/run-embedding-job.sh

# Or manually
gcloud run jobs execute generate-embeddings --region asia-south2 --wait
```

### View Job Logs

```bash
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=generate-embeddings" --limit 100 --format json
```

### Update Job Image (After Code Deployment)

After you deploy new code, update the job to use the latest image:

```bash
# Option 1: Use the update script
chmod +x scripts/update-cloud-run-job.sh
./scripts/update-cloud-run-job.sh

# Option 2: Manually update
IMAGE=$(gcloud run services describe broadway-chatbot --region asia-south2 --format='value(spec.template.spec.containers[0].image)')
gcloud run jobs update generate-embeddings --image=$IMAGE --region asia-south2
```

### Delete and Recreate Job (If Needed)

If you need to recreate the job with different settings:

```bash
# Delete existing job
gcloud run jobs delete generate-embeddings --region asia-south2

# Then recreate using the setup script
./scripts/setup-cloud-run-job.sh
```

### Benefits of Cloud Run Jobs

- ✅ No need to clone repo or install dependencies
- ✅ Uses same VPC network and security as your main service
- ✅ Automatic retry on failure
- ✅ View logs in Cloud Logging
- ✅ Can be triggered on schedule (if needed later)
- ✅ Uses production Docker image (consistent environment)

