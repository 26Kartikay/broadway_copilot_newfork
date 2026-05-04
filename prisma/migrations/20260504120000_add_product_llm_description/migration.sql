-- Text block for LLM-formatted product description (search + recommendations)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "llmDescription" TEXT;
