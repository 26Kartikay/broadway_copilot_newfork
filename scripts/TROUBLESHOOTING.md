# Troubleshooting Production Scripts

## Prisma Version Error

### Error: "The datasource property `url` is no longer supported"

**Problem:** You have Prisma CLI 7+ installed globally, but the project uses Prisma 6.

**Solution:** Use the npm script instead of `npx prisma`:

```bash
# ❌ Don't use this (uses global Prisma 7)
npx prisma generate

# ✅ Use this instead (uses local Prisma 6)
npm run prisma:generate
```

**If npm script doesn't exist, use the local binary:**
```bash
./node_modules/.bin/prisma generate
```

**If node_modules doesn't exist:**
```bash
npm install --legacy-peer-deps
npm run prisma:generate
```

---

## Missing Dependencies

### Error: "Cannot find module" or "Command not found"

**Solution:**
```bash
# Install all dependencies
npm install --legacy-peer-deps

# Then try again
npm run prisma:generate
```

---

## Environment Variables Not Set

### Error: "DATABASE_URL is not set" or "OPENAI_API_KEY is not set"

**Solution:**
```bash
# Get secrets from Google Secret Manager
export DATABASE_URL=$(gcloud secrets versions access latest --secret="PRIVATE_DATABASE_URL")
export OPENAI_API_KEY=$(gcloud secrets versions access latest --secret="OPENAI_API_KEY")
export NODE_ENV=production

# Verify they're set
echo $DATABASE_URL
echo $OPENAI_API_KEY
```

---

## Database Connection Issues

### Error: "Can't reach database server" or connection timeout

**Check:**
1. Is `DATABASE_URL` correct? (should be the private connection string)
2. Are you in the correct VPC network? (Cloud Shell should work, but check)
3. Is the database accessible from your current location?

**Test connection:**
```bash
# Test if you can reach the database
psql $DATABASE_URL -c "SELECT 1"
```

---

## Script Refuses to Run

### Error: "This script is designed to run in production only"

**Solution:**
```bash
# Set NODE_ENV to production
export NODE_ENV=production

# Or for testing locally
export ALLOW_LOCAL_EMBEDDING_GENERATION=true
```

---

## Import Script: File Not Found

### Error: "File not found at ..."

**Solution:**
1. Make sure the CSV file is in the current directory or provide full path
2. Check file permissions: `ls -la products.csv`
3. Use absolute path: `--file=/home/kartikay/products.csv`

---

## Quick Fix Checklist

Run these commands in order:

```bash
# 1. Set environment variables
export DATABASE_URL=$(gcloud secrets versions access latest --secret="PRIVATE_DATABASE_URL")
export OPENAI_API_KEY=$(gcloud secrets versions access latest --secret="OPENAI_API_KEY")
export NODE_ENV=production

# 2. Navigate to project
cd ~/broadway_copilot_newfork

# 3. Install dependencies
npm install --legacy-peer-deps

# 4. Generate Prisma client (use npm script)
npm run prisma:generate

# 5. Run your script
npx ts-node scripts/generateEmbeddings.ts
# OR
npx ts-node scripts/importProducts.ts --file=products.csv
```

---

## Still Having Issues?

1. Check Prisma version: `npx prisma --version` (should show 6.x, not 7.x)
2. Check Node version: `node --version` (should be 22+)
3. Check npm version: `npm --version`
4. View full error: Run commands without redirecting output to see full stack trace

