# Importing Products and Generating Embeddings in Production

This guide covers how to import products and generate embeddings in your production environment.

## Quick Start

**If you have no products in the database:**
1. Import products (embeddings are generated automatically during import)
2. Done! No need to run embedding generation separately

**If products exist but don't have embeddings:**
1. Run the embedding generation script

---

## Part 1: Importing Products

The import script automatically generates embeddings for all imported products, so you typically don't need to run embedding generation separately after importing.

### Option 1: Run from Cloud Shell (Recommended for Imports)

This is the easiest method since you can upload your CSV file directly.

#### Step 1: Get your secrets from Google Secret Manager

```bash
# Get DATABASE_URL (private connection string)
export DATABASE_URL=$(gcloud secrets versions access latest --secret="PRIVATE_DATABASE_URL")

# Get OPENAI_API_KEY
export OPENAI_API_KEY=$(gcloud secrets versions access latest --secret="OPENAI_API_KEY")

# Set production environment
export NODE_ENV=production
```

#### Step 2: Clone your repository

```bash
# If your repo is on GitHub
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# OR if you already have it cloned, just navigate to it
cd /path/to/your/repo
```

#### Step 3: Install dependencies

```bash
# Install dependencies
npm install --legacy-peer-deps
```

#### Step 4: Generate Prisma Client

```bash
npx prisma generate
```

#### Step 5: Upload your CSV file

Upload your products CSV file to Cloud Shell. You can:
- Use the Cloud Shell file upload feature (click the three dots menu → Upload file)
- Or use `gsutil` if your file is in Cloud Storage:
  ```bash
  gsutil cp gs://your-bucket/products.csv ./products.csv
  ```

#### Step 6: Run the import script

```bash
# Basic import (skips existing products)
npx ts-node scripts/importProducts.ts --file=products.csv

# Import with clearing existing products (⚠️ deletes all existing products first)
npx ts-node scripts/importProducts.ts --file=products.csv --clear
```

The import script will:
- Parse your CSV file
- Generate embeddings for each product automatically
- Insert products into the database with embeddings

**Required CSV columns:**
- `handle_id` - Unique product identifier
- `article_name` - Product name
- `brand` - Brand name
- `general_tags` - Product type tags
- `category` - Main category
- `component_tags` - Tags string (e.g., "STYLE: Athleisure, COLOR: Black")
- `images` - Product image URL
- `product_url` - Link to product page

**Optional columns:**
- `barcode` - Product barcode/SKU
- `description` - Product description (included in embeddings)

---

## Part 2: Generating Embeddings for Existing Products

If you have products in the database but they don't have embeddings (or you want to regenerate them), use this script.

### Option 1: Run from Cloud Shell (Recommended)

#### Step 1-4: Same as Part 1 (get secrets, clone, install, generate Prisma)

#### Step 5: Run the embedding generation script

```bash
# Generate embeddings for products without embeddings
npx ts-node scripts/generateEmbeddings.ts

# Force regenerate embeddings for ALL products
npx ts-node scripts/generateEmbeddings.ts --force
```

### Option 2: Use Cloud Run Jobs (Recommended for Repeated Use)

Cloud Run Jobs are perfect for one-off tasks. Once set up, you can execute them anytime with a single command.

#### Initial Setup (One-time)

**Step 1: Make sure your code is deployed**

The Cloud Run Job uses the same Docker image as your main service, so make sure you've pushed and deployed your code first.

**Step 2: Create the Cloud Run Job**

```bash
# Make the setup script executable (it will automatically get the latest image)
chmod +x scripts/setup-cloud-run-job.sh
./scripts/setup-cloud-run-job.sh
```

Or manually create it:

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

#### Execute the Job (Anytime)

After setup, you can run the embedding generation anytime:

```bash
# Using the helper script
chmod +x scripts/run-embedding-job.sh
./scripts/run-embedding-job.sh

# Or manually
gcloud run jobs execute generate-embeddings --region asia-south2 --wait
```

#### View Job Logs

```bash
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=generate-embeddings" --limit 100 --format json
```

#### Update Job Image (After Code Deployment)

After you deploy new code, update the job to use the latest image:

```bash
# Option 1: Use the update script
chmod +x scripts/update-cloud-run-job.sh
./scripts/update-cloud-run-job.sh

# Option 2: Manually update
IMAGE=$(gcloud run services describe broadway-chatbot --region asia-south2 --format='value(spec.template.spec.containers[0].image)')
gcloud run jobs update generate-embeddings --image=$IMAGE --region asia-south2
```

---

## Troubleshooting

### "All products already have embeddings!" but you have no products

This means your database has zero products. You need to import products first:
```bash
npx ts-node scripts/importProducts.ts --file=products.csv
```

### "No products found in database!"

The embedding script will now show this message if there are no products. Import products first using the import script.

### Import fails with "File not found"

Make sure:
1. The CSV file path is correct
2. You're running from the correct directory
3. The file exists and is readable

### Embedding generation fails

Check:
1. `OPENAI_API_KEY` is set correctly
2. You have API credits/quota available
3. The database connection is working (`DATABASE_URL` is correct)

### Cloud Run Job fails

Check the logs:
```bash
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=generate-embeddings" --limit 100 --format json
```

Common issues:
- Script not compiled (make sure `npm run build` includes scripts)
- Missing environment variables or secrets
- Database connection issues (VPC configuration)

---

## Benefits of Cloud Run Jobs

- ✅ No need to clone repo or install dependencies
- ✅ Uses same VPC network and security as your main service
- ✅ Automatic retry on failure
- ✅ View logs in Cloud Logging
- ✅ Can be triggered on schedule (if needed later)
- ✅ Uses production Docker image (consistent environment)

---

## Summary

**To import products with embeddings:**
1. Use Cloud Shell (easiest)
2. Export secrets
3. Clone repo, install deps
4. Upload CSV file
5. Run: `npx ts-node scripts/importProducts.ts --file=products.csv`

**To generate embeddings for existing products:**
1. Use Cloud Shell OR Cloud Run Job
2. Run: `npx ts-node scripts/generateEmbeddings.ts`
3. Or execute Cloud Run Job: `gcloud run jobs execute generate-embeddings --region asia-south2 --wait`
