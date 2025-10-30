-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."PendingType" ADD VALUE 'STYLE_STUDIO_MENU';
ALTER TYPE "public"."PendingType" ADD VALUE 'THIS_OR_THAT_IMAGE_INPUT';
ALTER TYPE "public"."PendingType" ADD VALUE 'THIS_OR_THAT_FIRST_IMAGE';
ALTER TYPE "public"."PendingType" ADD VALUE 'THIS_OR_THAT_SECOND_IMAGE';

-- AlterTable
ALTER TABLE "public"."Message" ADD COLUMN     "thisOrThatFirstImageId" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "dailyPromptOptIn" BOOLEAN NOT NULL DEFAULT false;
