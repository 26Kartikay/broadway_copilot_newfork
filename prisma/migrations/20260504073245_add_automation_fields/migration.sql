-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "allTags" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "automationErrors" TEXT[],
ADD COLUMN     "embeddingStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "legacyCategory" TEXT,
ADD COLUMN     "productType" TEXT,
ADD COLUMN     "subCategory" TEXT,
ADD COLUMN     "taggedAt" TIMESTAMP(3),
ADD COLUMN     "taggedBy" TEXT;

-- CreateTable
CREATE TABLE "AvailableBarcode" (
    "id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "lastChecked" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "productId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "syncErrors" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailableBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "averageDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errors" TEXT[],
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationFailure" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "barcode" TEXT,
    "reason" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetried" TIMESTAMP(3),
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvailableBarcode_barcode_key" ON "AvailableBarcode"("barcode");

-- CreateIndex
CREATE INDEX "AvailableBarcode_status_idx" ON "AvailableBarcode"("status");

-- CreateIndex
CREATE INDEX "AvailableBarcode_processedAt_idx" ON "AvailableBarcode"("processedAt");

-- CreateIndex
CREATE INDEX "AvailableBarcode_lastChecked_idx" ON "AvailableBarcode"("lastChecked");

-- CreateIndex
CREATE INDEX "AutomationRun_status_idx" ON "AutomationRun"("status");

-- CreateIndex
CREATE INDEX "AutomationRun_createdAt_idx" ON "AutomationRun"("createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_name_idx" ON "AutomationRun"("name");

-- CreateIndex
CREATE INDEX "AutomationFailure_productId_idx" ON "AutomationFailure"("productId");

-- CreateIndex
CREATE INDEX "AutomationFailure_retryCount_idx" ON "AutomationFailure"("retryCount");

-- CreateIndex
CREATE INDEX "AutomationFailure_createdAt_idx" ON "AutomationFailure"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationFailure_productId_runId_key" ON "AutomationFailure"("productId", "runId");

-- CreateIndex
CREATE INDEX "Product_legacyCategory_idx" ON "Product"("legacyCategory");

-- CreateIndex
CREATE INDEX "Product_subCategory_idx" ON "Product"("subCategory");

-- CreateIndex
CREATE INDEX "Product_embeddingStatus_idx" ON "Product"("embeddingStatus");

-- CreateIndex
CREATE INDEX "Product_taggedAt_idx" ON "Product"("taggedAt");
