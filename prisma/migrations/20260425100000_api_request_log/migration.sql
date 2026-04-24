-- CreateTable
CREATE TABLE "ApiRequestLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "severity" "Severity" NOT NULL DEFAULT 'INFO',
    "endpoint" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "intent" TEXT,
    "intentV2" TEXT,
    "error" TEXT,

    CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiRequestLog_createdAt_idx" ON "ApiRequestLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApiRequestLog_userId_createdAt_idx" ON "ApiRequestLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApiRequestLog_endpoint_createdAt_idx" ON "ApiRequestLog"("endpoint", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApiRequestLog_severity_createdAt_idx" ON "ApiRequestLog"("severity", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ApiRequestLog" ADD CONSTRAINT "ApiRequestLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
