# Production Migration Guide

## Schema Mismatch Check

### ✅ Current Status: **NO MISMATCHES FOUND**

**Enum Values Match:**
- **Gender**: Prisma schema maps `MALE/FEMALE/OTHER` → DB stores `male/female/other` ✅
- **Code uses**: `['male', 'female', 'other']` ✅
- **AgeGroup**: Prisma schema maps `TEEN/ADULT/SENIOR` → DB stores `teen/adult/senior` ✅
- **Code uses**: `['teen', 'adult', 'senior']` ✅

**Code correctly converts enum values:**
- `enumToDbValue()` function converts uppercase enum names to lowercase DB values
- Filter schema uses lowercase values matching database storage

## How to Apply Migrations in Production

### Option 1: Using Prisma Migrate (Recommended for Production)

**Step 1: Create Migration Locally**
```bash
# Make sure your schema changes are in prisma/schema.prisma
npx prisma migrate dev --name your_migration_name
```

**Step 2: Apply Migration in Production**

**Via Cloud Shell:**
```bash
# 1. Get production database URL
export DATABASE_URL=$(gcloud secrets versions access latest --secret="PRIVATE_DATABASE_URL")
export NODE_ENV=production

# 2. Navigate to your repo
cd /path/to/broadway_copilot_newfork

# 3. Install dependencies (if needed)
npm install --legacy-peer-deps

# 4. Generate Prisma client
npm run prisma:generate

# 5. Apply migrations
npx prisma migrate deploy
```

**Via Cloud Run Job (One-time Setup):**
```bash
# Create a migration job
gcloud run jobs create prisma-migrate \
  --image asia-south2-docker.pkg.dev/broadway-chatbot/broadway-chatbot/broadway-chatbot:latest \
  --region asia-south2 \
  --task-timeout 300 \
  --max-retries 1 \
  --set-env-vars NODE_ENV=production \
  --set-secrets DATABASE_URL=PRIVATE_DATABASE_URL:latest \
  --vpc-network chatbot-vpc \
  --vpc-subnet chatbot-subnet \
  --vpc-egress private-ranges-only \
  --memory 2Gi \
  --cpu 1 \
  --command node \
  --args -e "require('child_process').execSync('npx prisma migrate deploy', {stdio: 'inherit'})"

# Execute when needed
gcloud run jobs execute prisma-migrate --region asia-south2 --wait
```

### Option 2: Using Prisma DB Push (Quick Sync - Dev Only)

**⚠️ WARNING: `db push` is NOT recommended for production!**
- It doesn't create migration history
- Can cause data loss if schema changes are destructive
- Use only for development/testing

**If you must use it:**
```bash
export DATABASE_URL=$(gcloud secrets versions access latest --secret="PRIVATE_DATABASE_URL")
npx prisma db push
```

### Option 3: Manual SQL Migration (For Complex Changes)

If you have complex migrations that need manual review:

```bash
# 1. Generate migration SQL
npx prisma migrate dev --create-only --name your_migration_name

# 2. Review the generated SQL in prisma/migrations/your_migration_name/migration.sql

# 3. Apply manually via psql or Cloud SQL console
psql $DATABASE_URL -f prisma/migrations/your_migration_name/migration.sql
```

## Current Migration Status

**Issue:** No migration files found in `prisma/migrations/` (only `migration_lock.toml`)

**This means:**
- You're currently using `prisma db push` (development mode)
- No migration history exists
- Production might be out of sync

## Recommended Action Plan

### 1. Create Initial Migration (Baseline)

```bash
# This creates a baseline migration from current schema
npx prisma migrate dev --name initial_baseline
```

### 2. Check Production Schema Status

```bash
# Connect to production DB
export DATABASE_URL=$(gcloud secrets versions access latest --secret="PRIVATE_DATABASE_URL")

# Check if schema is in sync
npx prisma migrate status

# If out of sync, you may need to:
# - Mark migrations as applied (if schema matches): npx prisma migrate resolve --applied <migration_name>
# - Or apply pending migrations: npx prisma migrate deploy
```

### 3. Update Dockerfile (Optional - Add Migration Step)

If you want migrations to run automatically on deployment:

```dockerfile
# Add to Dockerfile before CMD
RUN npx prisma migrate deploy || echo "Migrations failed, check logs"
```

**⚠️ Note:** This can cause deployment failures if migrations fail. Better to run migrations separately.

## Verification Steps

After applying migrations:

```bash
# 1. Verify schema is in sync
npx prisma migrate status

# 2. Test Prisma client generation
npx prisma generate

# 3. Verify enum values in database
psql $DATABASE_URL -c "SELECT DISTINCT gender FROM \"Product\" LIMIT 5;"
psql $DATABASE_URL -c "SELECT DISTINCT \"ageGroup\" FROM \"Product\" LIMIT 5;"
```

## Troubleshooting

### Error: "Migration X is not in the database"
- **Solution**: Mark as applied if schema already matches: `npx prisma migrate resolve --applied <migration_name>`

### Error: "Database schema is out of sync"
- **Solution**: Run `npx prisma migrate deploy` to apply pending migrations

### Error: "Can't reach database server"
- **Solution**: Check DATABASE_URL, VPC access, and Cloud SQL Proxy connection

## Best Practices

1. **Always create migrations** for schema changes (don't use `db push` in production)
2. **Test migrations locally** before applying to production
3. **Backup database** before applying migrations in production
4. **Review generated SQL** for destructive operations
5. **Run migrations separately** from application deployment (don't auto-run in Dockerfile)

