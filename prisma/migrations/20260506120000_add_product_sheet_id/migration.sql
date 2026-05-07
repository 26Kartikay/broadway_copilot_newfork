-- AlterTable
ALTER TABLE "Product" ADD COLUMN "sheet_id" TEXT;

-- CreateIndex
CREATE INDEX "Product_sheet_id_idx" ON "Product"("sheet_id");
