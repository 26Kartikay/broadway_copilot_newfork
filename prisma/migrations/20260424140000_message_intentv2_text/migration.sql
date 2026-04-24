-- intentv2: plain-text classifier inference (replace JSONB column if it exists).
ALTER TABLE "Message" DROP COLUMN IF EXISTS "intentv2";
ALTER TABLE "Message" ADD COLUMN "intentv2" TEXT;
