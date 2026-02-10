-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector" WITH VERSION "0.8.1";

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'AI', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('teen', 'adult', 'senior');

-- CreateEnum
CREATE TYPE "PendingType" AS ENUM ('NONE', 'VIBE_CHECK_IMAGE', 'COLOR_ANALYSIS_IMAGE', 'ASK_USER_INFO', 'FEEDBACK', 'TONALITY_SELECTION', 'STYLE_STUDIO_MENU', 'THIS_OR_THAT_IMAGE_INPUT', 'THIS_OR_THAT_FIRST_IMAGE', 'THIS_OR_THAT_SECOND_IMAGE', 'FASHION_QUIZ_START', 'FASHION_QUIZ_QUESTION_1', 'FASHION_QUIZ_QUESTION_2', 'FASHION_QUIZ_QUESTION_3', 'FASHION_QUIZ_QUESTION_4', 'FASHION_QUIZ_QUESTION_5', 'FASHION_QUIZ_QUESTION_6', 'FASHION_QUIZ_QUESTION_7', 'FASHION_QUIZ_QUESTION_8', 'FASHION_QUIZ_QUESTION_9', 'FASHION_QUIZ_QUESTION_10', 'FASHION_QUIZ_RESULTS', 'SAVE_COLOR_ANALYSIS', 'CONFIRM_PRODUCT_RECOMMENDATION');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('SEND_FEEDBACK_REQUEST', 'SCHEDULE_WARDROBE_INDEX', 'PROCESS_MEMORIES', 'UPLOAD_IMAGES');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GraphRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'ERROR', 'ABORTED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "WardrobeItemCategory" AS ENUM ('TOP', 'BOTTOM', 'ONE_PIECE', 'OUTERWEAR', 'SHOES', 'BAG', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('CLOTHING_FASHION', 'BEAUTY_PERSONAL_CARE', 'HEALTH_WELLNESS', 'JEWELLERY_ACCESSORIES', 'FOOTWEAR', 'BAGS_LUGGAGE');

-- CreateEnum
CREATE TYPE "Tonality" AS ENUM ('savage', 'friendly', 'hype_bff');

-- CreateEnum
CREATE TYPE "Fit" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "whatsappId" TEXT NOT NULL,
    "profileName" TEXT NOT NULL DEFAULT '',
    "confirmedGender" "Gender",
    "confirmedAgeGroup" "AgeGroup",
    "fitPreference" "Fit",
    "lastVibeCheckAt" TIMESTAMP(3),
    "lastColorAnalysisAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncVersion" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dailyPromptOptIn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "intent" TEXT,
    "buttonPayload" TEXT,
    "pending" "PendingType" DEFAULT 'NONE',
    "selectedTonality" "Tonality",
    "content" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "additionalKwargs" JSONB,
    "thisOrThatFirstImageId" TEXT,
    "memoriesProcessed" BOOLEAN NOT NULL DEFAULT false,
    "wardrobeProcessed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
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
CREATE TABLE "Memory" (
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
CREATE TABLE "VibeCheck" (
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
CREATE TABLE "ColorAnalysis" (
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
CREATE TABLE "WardrobeItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "WardrobeItemCategory" NOT NULL,
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
CREATE TABLE "GraphRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "GraphRunStatus" NOT NULL DEFAULT 'RUNNING',
    "errorTrace" TEXT,
    "initialState" JSONB NOT NULL,
    "finalState" JSONB,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "GraphRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMTrace" (
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
CREATE TABLE "NodeRun" (
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
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "helpful" BOOLEAN,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB,
    "runAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminWhitelist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "AdminWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWhitelist" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,

    CONSTRAINT "UserWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" TIMESTAMP(3),

    CONSTRAINT "Admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAccount" (
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
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminVerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "AdminAuthenticator" (
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
CREATE UNIQUE INDEX "User_appUserId_key" ON "User"("appUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_whatsappId_key" ON "User"("whatsappId");

-- CreateIndex
CREATE INDEX "User_appUserId_idx" ON "User"("appUserId");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Conversation_userId_createdAt_idx" ON "Conversation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_status_createdAt_idx" ON "Conversation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_role_createdAt_idx" ON "Message"("role", "createdAt");

-- CreateIndex
CREATE INDEX "Message_buttonPayload_idx" ON "Message"("buttonPayload");

-- CreateIndex
CREATE INDEX "Media_messageId_idx" ON "Media"("messageId");

-- CreateIndex
CREATE INDEX "Memory_userId_createdAt_idx" ON "Memory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VibeCheck_userId_createdAt_idx" ON "VibeCheck"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ColorAnalysis_userId_createdAt_idx" ON "ColorAnalysis"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_category_idx" ON "WardrobeItem"("userId", "category");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_type_idx" ON "WardrobeItem"("userId", "type");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_mainColor_idx" ON "WardrobeItem"("userId", "mainColor");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_createdAt_idx" ON "WardrobeItem"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WardrobeItem_userId_keywords_idx" ON "WardrobeItem"("userId", "keywords");

-- CreateIndex
CREATE INDEX "GraphRun_conversationId_startTime_idx" ON "GraphRun"("conversationId", "startTime");

-- CreateIndex
CREATE INDEX "GraphRun_userId_startTime_idx" ON "GraphRun"("userId", "startTime");

-- CreateIndex
CREATE INDEX "LLMTrace_nodeRunId_idx" ON "LLMTrace"("nodeRunId");

-- CreateIndex
CREATE INDEX "NodeRun_graphRunId_idx" ON "NodeRun"("graphRunId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_conversationId_key" ON "Feedback"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_taskId_key" ON "Task"("taskId");

-- CreateIndex
CREATE INDEX "Task_userId_runAt_idx" ON "Task"("userId", "runAt");

-- CreateIndex
CREATE INDEX "Task_status_runAt_idx" ON "Task"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminWhitelist_email_key" ON "AdminWhitelist"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserWhitelist_waId_key" ON "UserWhitelist"("waId");

-- CreateIndex
CREATE UNIQUE INDEX "Admins_email_key" ON "Admins"("email");

-- CreateIndex
CREATE INDEX "AdminAccount_userId_idx" ON "AdminAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccount_provider_providerAccountId_key" ON "AdminAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_sessionToken_key" ON "AdminSession"("sessionToken");

-- CreateIndex
CREATE INDEX "AdminSession_userId_idx" ON "AdminSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminVerificationToken_token_key" ON "AdminVerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "AdminVerificationToken_identifier_token_key" ON "AdminVerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAuthenticator_credentialID_key" ON "AdminAuthenticator"("credentialID");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VibeCheck" ADD CONSTRAINT "VibeCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColorAnalysis" ADD CONSTRAINT "ColorAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WardrobeItem" ADD CONSTRAINT "WardrobeItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphRun" ADD CONSTRAINT "GraphRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphRun" ADD CONSTRAINT "GraphRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMTrace" ADD CONSTRAINT "LLMTrace_nodeRunId_fkey" FOREIGN KEY ("nodeRunId") REFERENCES "NodeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeRun" ADD CONSTRAINT "NodeRun_graphRunId_fkey" FOREIGN KEY ("graphRunId") REFERENCES "GraphRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAccount" ADD CONSTRAINT "AdminAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuthenticator" ADD CONSTRAINT "AdminAuthenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
