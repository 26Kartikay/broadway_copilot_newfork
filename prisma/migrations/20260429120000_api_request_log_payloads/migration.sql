-- AlterTable
ALTER TABLE "ApiRequestLog" ADD COLUMN "requestPayload" JSONB;
ALTER TABLE "ApiRequestLog" ADD COLUMN "responsePayload" JSONB;
