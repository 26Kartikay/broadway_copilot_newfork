-- Prisma db push issues DROP INDEX for legacy @unique(handleId); Postgres requires
-- dropping the constraint first. Safe on fresh DBs (skips if "Product" does not exist).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'Product'
  ) THEN
    ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_handleId_key";
    ALTER TABLE "Product" DROP COLUMN IF EXISTS "handleId";
  END IF;
END $$;
