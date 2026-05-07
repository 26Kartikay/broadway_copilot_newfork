-- Rename external feed id column (was sheet_id) to db_id; Prisma field dbId.
ALTER TABLE "Product" RENAME COLUMN "sheet_id" TO "db_id";
ALTER INDEX "Product_sheet_id_idx" RENAME TO "Product_db_id_idx";
