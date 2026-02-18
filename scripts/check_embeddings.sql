-- ============================================================================
-- Check Embeddings in Production Database
-- ============================================================================
-- Run these queries to verify if embeddings are present and correct
-- ============================================================================

-- 1. Check total products vs products with embeddings
SELECT 
    COUNT(*) as total_products,
    COUNT(embedding) as products_with_embeddings,
    COUNT(*) - COUNT(embedding) as products_without_embeddings,
    ROUND(COUNT(embedding)::numeric / COUNT(*)::numeric * 100, 2) as percentage_with_embeddings
FROM "Product";

-- 2. Check embedding metadata (model, dimension, timestamp)
SELECT 
    COUNT(*) as total_with_embeddings,
    COUNT(DISTINCT "embeddingModel") as unique_models,
    COUNT(DISTINCT "embeddingDim") as unique_dimensions,
    MIN("embeddingAt") as oldest_embedding,
    MAX("embeddingAt") as newest_embedding
FROM "Product"
WHERE embedding IS NOT NULL;

-- 3. Check embedding model distribution
SELECT 
    "embeddingModel",
    "embeddingDim",
    COUNT(*) as count,
    MIN("embeddingAt") as first_generated,
    MAX("embeddingAt") as last_generated
FROM "Product"
WHERE embedding IS NOT NULL
GROUP BY "embeddingModel", "embeddingDim"
ORDER BY count DESC;

-- 4. Sample products with and without embeddings
SELECT 
    barcode,
    name,
    "embeddingModel",
    "embeddingDim",
    "embeddingAt",
    CASE 
        WHEN embedding IS NOT NULL THEN 'Has embedding'
        ELSE 'No embedding'
    END as embedding_status
FROM "Product"
ORDER BY "embeddingAt" DESC NULLS LAST
LIMIT 10;

-- 5. Check if embedding vector has correct dimensions (should be 1536 for text-embedding-3-small)
-- Note: This requires the vector extension to be enabled
SELECT 
    barcode,
    name,
    "embeddingDim",
    array_length(embedding::float[], 1) as actual_dimension,
    CASE 
        WHEN array_length(embedding::float[], 1) = "embeddingDim" THEN 'Correct'
        WHEN array_length(embedding::float[], 1) IS NULL THEN 'NULL'
        ELSE 'Mismatch'
    END as dimension_check
FROM "Product"
WHERE embedding IS NOT NULL
LIMIT 10;

-- 6. Check products that should have embeddings but don't
SELECT 
    barcode,
    name,
    gender,
    "ageGroup",
    "embeddingAt",
    CASE 
        WHEN embedding IS NULL AND "embeddingAt" IS NOT NULL THEN 'Timestamp but no vector'
        WHEN embedding IS NOT NULL AND "embeddingAt" IS NULL THEN 'Vector but no timestamp'
        WHEN embedding IS NULL THEN 'Missing'
        ELSE 'OK'
    END as status
FROM "Product"
WHERE embedding IS NULL OR "embeddingAt" IS NULL
ORDER BY "createdAt" DESC
LIMIT 20;

-- 7. Quick summary for production debugging
SELECT 
    'Total Products' as metric,
    COUNT(*)::text as value
FROM "Product"
UNION ALL
SELECT 
    'Products with Embeddings' as metric,
    COUNT(embedding)::text as value
FROM "Product"
WHERE embedding IS NOT NULL
UNION ALL
SELECT 
    'Products without Embeddings' as metric,
    COUNT(*)::text as value
FROM "Product"
WHERE embedding IS NULL
UNION ALL
SELECT 
    'Latest Embedding Generated' as metric,
    COALESCE(MAX("embeddingAt")::text, 'Never') as value
FROM "Product";

