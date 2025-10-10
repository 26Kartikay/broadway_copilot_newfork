-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector" WITH VERSION "0.8.1";

-- CreateEnum
CREATE TYPE "public"."MessageRole" AS ENUM ('USER', 'AI', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "public"."Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "public"."AgeGroup" AS ENUM ('AGE_13_17', 'AGE_18_25', 'AGE_26_35', 'AGE_36_45', 'AGE_46_55', 'AGE_55_PLUS');

-- CreateEnum
CREATE TYPE "public"."PendingType" AS ENUM ('NONE', 'VIBE_CHECK_IMAGE', 'COLOR_ANALYSIS_IMAGE', 'ASK_USER_INFO', 'FEEDBACK', 'TONALITY_SELECTION');

-- CreateEnum
CREATE TYPE "public"."TaskType" AS ENUM ('SEND_FEEDBACK_REQUEST', 'SCHEDULE_WARDROBE_INDEX', 'PROCESS_MEMORIES', 'UPLOAD_IMAGES');

-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."GraphRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'ERROR', 'ABORTED');

-- CreateEnum
CREATE TYPE "public"."ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."WardrobeItemCategory" AS ENUM ('TOP', 'BOTTOM', 'ONE_PIECE', 'OUTERWEAR', 'SHOES', 'BAG', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "public"."Tonality" AS ENUM ('savage', 'friendly', 'hype_bff');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "whatsappId" TEXT NOT NULL,
    "profileName" TEXT NOT NULL DEFAULT '',
    "inferredGender" "public"."Gender",
    "inferredAgeGroup" "public"."AgeGroup",
    "confirmedGender" "public"."Gender",
    "confirmedAgeGroup" "public"."AgeGroup",
    "lastVibeCheckAt" TIMESTAMP(3),
    "lastColorAnalysisAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "public"."MessageRole" NOT NULL,
    "intent" TEXT,
    "buttonPayload" TEXT,
    "pending" "public"."PendingType" DEFAULT 'NONE',
    "selectedTonality" "public"."Tonality",
    "content" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "additionalKwargs" JSONB,
    "memoriesProcessed" BOOLEAN NOT NULL DEFAULT false,
    "wardrobeProcessed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Media" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "twilioUrl" TEXT NOT NULL,
    "serverUrl" TEXT NOT NULL,
    "gcsUri" TEXT,
    "mimeType" TEXT NOT NULL,
    "isUploaded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Memory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memory" TEXT NOT NULL,
    "embedding" vector,
    "embeddingModel" TEXT,
    "embeddingDim" INTEGER,
    "embeddingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VibeCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "fit_silhouette_score" DOUBLE PRECISION NOT NULL,
    "fit_silhouette_explanation" TEXT NOT NULL,
    "color_harmony_score" DOUBLE PRECISION NOT NULL,
    "color_harmony_explanation" TEXT NOT NULL,
    "styling_details_score" DOUBLE PRECISION NOT NULL,
    "styling_details_explanation" TEXT NOT NULL,
    "context_confidence_score" DOUBLE PRECISION NOT NULL,
    "context_confidence_explanation" TEXT NOT NULL,
    "overall_score" DOUBLE PRECISION NOT NULL,
    "recommendations" TEXT[],
    "prompt" TEXT NOT NULL,
    "tonality" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VibeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ColorAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skin_tone" TEXT,
    "eye_color" TEXT,
    "hair_color" TEXT,
    "undertone" TEXT,
    "compliment" TEXT,
    "palette_name" TEXT,
    "palette_description" TEXT,
    "colors_suited" JSONB,
    "colors_to_wear" JSONB,
    "colors_to_avoid" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColorAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WardrobeItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "public"."WardrobeItemCategory" NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "mainColor" TEXT NOT NULL,
    "secondaryColor" TEXT,
    "attributes" JSONB NOT NULL,
    "searchDoc" TEXT NOT NULL,
    "keywords" TEXT[],
    "embedding" vector,
    "embeddingModel" TEXT,
    "embeddingDim" INTEGER,
    "embeddingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WardrobeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GraphRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "public"."GraphRunStatus" NOT NULL DEFAULT 'RUNNING',
    "errorTrace" TEXT,
    "initialState" JSONB NOT NULL,
    "finalState" JSONB,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "GraphRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LLMTrace" (
    "id" TEXT NOT NULL,
    "nodeRunId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "costUsd" DECIMAL(10,6),
    "errorTrace" TEXT,
    "inputMessages" JSONB NOT NULL,
    "outputMessage" JSONB,
    "rawRequest" JSONB NOT NULL,
    "rawResponse" JSONB,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "LLMTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NodeRun" (
    "id" TEXT NOT NULL,
    "graphRunId" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Feedback" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "helpful" BOOLEAN,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Task" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."TaskType" NOT NULL,
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB,
    "runAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminWhitelist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "AdminWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserWhitelist" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,

    CONSTRAINT "UserWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),

    CONSTRAINT "Admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminSession" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminVerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "public"."AdminAuthenticator" (
    "credentialID" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "credentialPublicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "credentialDeviceType" TEXT NOT NULL,
    "credentialBackedUp" BOOLEAN NOT NULL,
    "transports" TEXT,

    CONSTRAINT "AdminAuthenticator_pkey" PRIMARY KEY ("userId","credentialID")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_whatsappId_key" ON "public"."User"("whatsappId");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "public"."User"("createdAt");

-- CreateIndex
CREATE INDEX "Conversation_userId_createdAt_idx" ON "public"."Conversation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_status_createdAt_idx" ON "public"."Conversation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "public"."Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_role_createdAt_idx" ON "public"."Message"("role", "createdAt");

-- CreateIndex
CREATE INDEX "Message_buttonPayload_idx" ON "public"."Message"("buttonPayload");

-- CreateIndex
CREATE INDEX "Media_messageId_idx" ON "public"."Media"("messageId");

-- CreateIndex
CREATE INDEX "Memory_userId_createdAt_idx" ON "public"."Memory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VibeCheck_userId_createdAt_idx" ON "public"."VibeCheck"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ColorAnalysis_userId_createdAt_idx" ON "public"."ColorAnalysis"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_category_idx" ON "public"."WardrobeItem"("userId", "category");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_type_idx" ON "public"."WardrobeItem"("userId", "type");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_mainColor_idx" ON "public"."WardrobeItem"("userId", "mainColor");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_createdAt_idx" ON "public"."WardrobeItem"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_keywords_idx" ON "public"."WardrobeItem"("userId", "keywords");

-- CreateIndex
CREATE INDEX "GraphRun_conversationId_startTime_idx" ON "public"."GraphRun"("conversationId", "startTime");

-- CreateIndex
CREATE INDEX "GraphRun_userId_startTime_idx" ON "public"."GraphRun"("userId", "startTime");

-- CreateIndex
CREATE INDEX "LLMTrace_nodeRunId_idx" ON "public"."LLMTrace"("nodeRunId");

-- CreateIndex
CREATE INDEX "NodeRun_graphRunId_idx" ON "public"."NodeRun"("graphRunId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_conversationId_key" ON "public"."Feedback"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_taskId_key" ON "public"."Task"("taskId");

-- CreateIndex
CREATE INDEX "Task_userId_runAt_idx" ON "public"."Task"("userId", "runAt");

-- CreateIndex
CREATE INDEX "Task_status_runAt_idx" ON "public"."Task"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminWhitelist_email_key" ON "public"."AdminWhitelist"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserWhitelist_waId_key" ON "public"."UserWhitelist"("waId");

-- CreateIndex
CREATE UNIQUE INDEX "Admins_email_key" ON "public"."Admins"("email");

-- CreateIndex
CREATE INDEX "AdminAccount_userId_idx" ON "public"."AdminAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccount_provider_providerAccountId_key" ON "public"."AdminAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_sessionToken_key" ON "public"."AdminSession"("sessionToken");

-- CreateIndex
CREATE INDEX "AdminSession_userId_idx" ON "public"."AdminSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminVerificationToken_token_key" ON "public"."AdminVerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "AdminVerificationToken_identifier_token_key" ON "public"."AdminVerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAuthenticator_credentialID_key" ON "public"."AdminAuthenticator"("credentialID");

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Media" ADD CONSTRAINT "Media_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Memory" ADD CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VibeCheck" ADD CONSTRAINT "VibeCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ColorAnalysis" ADD CONSTRAINT "ColorAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WardrobeItem" ADD CONSTRAINT "WardrobeItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GraphRun" ADD CONSTRAINT "GraphRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GraphRun" ADD CONSTRAINT "GraphRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LLMTrace" ADD CONSTRAINT "LLMTrace_nodeRunId_fkey" FOREIGN KEY ("nodeRunId") REFERENCES "public"."NodeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NodeRun" ADD CONSTRAINT "NodeRun_graphRunId_fkey" FOREIGN KEY ("graphRunId") REFERENCES "public"."GraphRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Feedback" ADD CONSTRAINT "Feedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdminAccount" ADD CONSTRAINT "AdminAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AdminAuthenticator" ADD CONSTRAINT "AdminAuthenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
