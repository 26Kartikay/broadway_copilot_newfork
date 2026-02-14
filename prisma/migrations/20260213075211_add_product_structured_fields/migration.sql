-- AlterTable
ALTER TABLE "User" ADD COLUMN     "inferredAgeGroup" "AgeGroup",
ADD COLUMN     "inferredGender" "Gender";

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "gender" "Gender",
    "ageGroup" "AgeGroup",
    "description" TEXT,
    "imageUrl" TEXT,
    "colors" TEXT[],
    "category" TEXT,
    "subCategory" TEXT,
    "productType" TEXT,
    "style" TEXT,
    "occasion" TEXT,
    "fit" TEXT,
    "season" TEXT,
    "popularityScore" DOUBLE PRECISION DEFAULT 0.0,
    "embedding" vector,
    "embeddingModel" TEXT,
    "embeddingDim" INTEGER,
    "embeddingAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_brandName_idx" ON "Product"("brandName");

-- CreateIndex
CREATE INDEX "Product_gender_idx" ON "Product"("gender");

-- CreateIndex
CREATE INDEX "Product_ageGroup_idx" ON "Product"("ageGroup");

-- CreateIndex
CREATE INDEX "Product_colors_idx" ON "Product"("colors");

-- CreateIndex
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

-- CreateIndex
CREATE INDEX "Product_createdAt_idx" ON "Product"("createdAt");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_subCategory_idx" ON "Product"("subCategory");

-- CreateIndex
CREATE INDEX "Product_productType_idx" ON "Product"("productType");

-- CreateIndex
CREATE INDEX "Product_brandName_category_idx" ON "Product"("brandName", "category");

-- CreateIndex
CREATE INDEX "Product_isActive_gender_ageGroup_idx" ON "Product"("isActive", "gender", "ageGroup");
