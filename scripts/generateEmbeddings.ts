/**
 * Generate Embeddings for Existing Products
 * 
 * Generates vector embeddings for products that don't have embeddings yet.
 * This script is useful when:
 * - Products were imported without embeddings
 * - You need to regenerate embeddings after changing the embedding model
 * - You want to update embeddings for existing products
 * 
 * Usage:
 *   npx ts-node scripts/generateEmbeddings.ts
 *   npx ts-node scripts/generateEmbeddings.ts --force  (regenerate all embeddings)
 */

import 'dotenv/config';
import { PrismaClient, Gender, AgeGroup } from '@prisma/client';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration
const BATCH_SIZE = 100; // Products per batch for embedding
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

interface ProductData {
  id: string;
  name: string | null;
  brandName: string | null;
  gender: Gender;
  ageGroup?: AgeGroup | null;
  imageUrl: string;
  colors: string[];
  category?: string | null;
  subCategory?: string | null;
  productType?: string | null;
  colorPalette?: string | null;
  allTags?: string | null;
}

/**
 * Builds an enriched search document for embedding generation.
 * Includes all structured attributes to improve semantic search quality.
 */
function buildSearchDoc(product: ProductData): string {
  const parts: string[] = [];
  
  if (product.name) {
    parts.push(product.name);
  }
  if (product.brandName) {
    parts.push(`Brand: ${product.brandName}`);
  }

  // Core structured attributes
  if (product.category) {
    parts.push(`Category: ${product.category}`);
  }
  if (product.subCategory) {
    parts.push(`Subcategory: ${product.subCategory}`);
  }
  if (product.productType) {
    parts.push(`Product Type: ${product.productType}`);
  }
  if (product.gender) {
    parts.push(`Gender: ${product.gender}`);
  }
  if (product.ageGroup) {
    parts.push(`Age Group: ${product.ageGroup}`);
  }
  
  // Color palette
  if (product.colorPalette) {
    parts.push(`Color Palette: ${product.colorPalette}`);
  }
  
  // Colors
  if (product.colors && product.colors.length > 0) {
    parts.push(`Colors: ${product.colors.join(', ')}`);
  }
  
  // All tags
  if (product.allTags) {
    parts.push(`Tags: ${product.allTags}`);
  }
  
  // Ensure we always return something (at minimum, use gender or a placeholder)
  if (parts.length === 0) {
    parts.push(`Product (Gender: ${product.gender || 'unknown'})`);
  }
  
  return parts.join('. ');
}

/**
 * Generates embeddings for a batch of texts.
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data.map(d => d.embedding);
}

async function generateEmbeddingsForProducts(forceRegenerate: boolean = false) {
  console.log('🚀 Starting embedding generation for products...\n');

  // Find products that need embeddings
  // Note: embedding field is Unsupported("vector") so we can't filter by it directly in Prisma
  // We'll use raw SQL for counting
  let totalProducts: number;
  
  if (forceRegenerate) {
    totalProducts = await prisma.product.count();
  } else {
    // Use raw SQL to count products without embeddings or with wrong model
    const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM "Product" 
       WHERE ("embedding" IS NULL OR "embeddingModel" IS NULL OR "embeddingModel" != $1)`,
      EMBEDDING_MODEL
    );
    totalProducts = Number(result[0].count);
  }
  
  // Check if there are any products at all
  const totalProductsInDb = await prisma.product.count();
  
  if (totalProductsInDb === 0) {
    console.log('⚠️  No products found in database!');
    console.log('   You need to import products first using:');
    console.log('   npx ts-node scripts/importProducts.ts --file=products.csv');
    return;
  }
  
  if (totalProducts === 0) {
    console.log('✅ All products already have embeddings!');
    return;
  }

  console.log(`📋 Found ${totalProducts} products ${forceRegenerate ? 'to regenerate embeddings for' : 'without embeddings'}\n`);

  let processed = 0;
  let updated = 0;
  let errors = 0;
  let batchNumber = 0;

  // Process in batches - continue until no more products are found
  while (true) {
    batchNumber++;
      // Use raw SQL to query products (embedding field is Unsupported type, can't filter with Prisma)
      let products: Array<{
        id: string;
        name: string | null;
        brandName: string | null;
        gender: Gender;
        ageGroup: AgeGroup | null;
        imageUrl: string;
        colors: string[];
        category: string | null;
        subCategory: string | null;
        productType: string | null;
        colorPalette: string | null;
        allTags: string | null;
      }>;

      if (forceRegenerate) {
        // Get all products using Prisma - get next batch without embeddings
        // Query for products that either don't have embeddings or have wrong model
        products = await prisma.$queryRawUnsafe<typeof products>(
                `SELECT id, name, "brandName", gender, "ageGroup", "imageUrl", colors,
                        category, "subCategory", "productType", "colorPalette", "allTags"
                 FROM "Product"
                 WHERE ("embedding" IS NULL OR "embeddingModel" IS NULL OR "embeddingModel" != $1)
                 ORDER BY "createdAt" DESC
                 LIMIT $2`,
          EMBEDDING_MODEL,
          BATCH_SIZE
        );
      } else {
        // Use raw SQL to get products without embeddings or with wrong model
        // Don't use OFFSET - just get the next batch of products that need embeddings
        products = await prisma.$queryRawUnsafe<typeof products>(
                `SELECT id, name, "brandName", gender, "ageGroup", "imageUrl", colors,
                        category, "subCategory", "productType", "colorPalette", "allTags"
                 FROM "Product"
                 WHERE ("embedding" IS NULL OR "embeddingModel" IS NULL OR "embeddingModel" != $1)
                 ORDER BY "createdAt" DESC
                 LIMIT $2`,
          EMBEDDING_MODEL,
          BATCH_SIZE
        );
      }

    if (products.length === 0) {
      console.log(`\n✅ No more products to process. Completed ${batchNumber - 1} batches.`);
      break;
    }

    console.log(`\n🔄 Processing batch ${batchNumber} (${products.length} products)`);

      // Build search documents - ensure all products have valid search docs
      const searchDocs: string[] = [];
      const validProducts: typeof products = [];
      
      for (const product of products) {
        if (!product) continue;
        const searchDoc = buildSearchDoc(product as any);
        // buildSearchDoc now always returns a non-empty string, so we can include all products
        if (searchDoc && searchDoc.trim().length > 0) {
          searchDocs.push(searchDoc);
          validProducts.push(product);
        } else {
          console.warn(`⚠️ Skipping product ${product.id} - could not generate search document`);
        }
      }

      if (validProducts.length === 0) {
        console.log('⚠️ No valid products in this batch, skipping...');
        // Continue to next batch instead of breaking, in case there are more products
        continue;
      }

    try {
      // Generate embeddings
      console.log(`🧠 Generating embeddings for ${validProducts.length} products...`);
      const embeddings = await generateEmbeddings(searchDocs);

      if (embeddings.length !== validProducts.length || embeddings.length !== searchDocs.length) {
        throw new Error(`Mismatch: ${validProducts.length} products, ${searchDocs.length} docs, ${embeddings.length} embeddings`);
      }

      // Update products with embeddings
      console.log(`💾 Updating products with embeddings...`);
      
      for (let i = 0; i < validProducts.length; i++) {
        const product = validProducts[i];
        const embedding = embeddings[i];
        const searchDoc = searchDocs[i];

        if (!product || !embedding || !searchDoc) {
          console.error(`❌ Missing data for product at index ${i}`);
          errors++;
          continue;
        }

        try {
          // Update searchDoc first
          await prisma.product.update({
            where: { id: product.id },
            data: {
              embeddingModel: EMBEDDING_MODEL,
              embeddingDim: EMBEDDING_DIM,
              embeddingAt: new Date(),
            },
          });

          // Update embedding using raw SQL (Prisma doesn't support vector type directly)
          const vectorString = `[${embedding.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE "Product" SET embedding = $1::vector WHERE id = $2`,
            vectorString,
            product.id
          );

          updated++;
        } catch (err: any) {
          console.error(`❌ Error updating product ${product.id}: ${err.message}`);
          errors++;
        }
      }

      processed += products.length;
      console.log(`✅ Batch complete: ${updated} updated, ${errors} errors`);

      // Rate limiting: wait 1 second between batches to avoid API rate limits
      // Always wait (except after the last batch which breaks the loop)
      console.log('⏳ Waiting 1 second for rate limiting...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err: any) {
      console.error(`❌ Error processing batch: ${err.message}`);
      errors += products.length;
      processed += products.length;
    }
  }

  console.log('\n==================================================');
  console.log('📊 EMBEDDING GENERATION SUMMARY');
  console.log('==================================================');
  console.log(`✅ Updated: ${updated}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📦 Total Processed: ${processed}`);
  console.log('==================================================\n');
}

async function main() {
  // Safety check: Only allow running in production or when explicitly allowed
  const isProduction = process.env.NODE_ENV === 'production';
  const allowLocal = process.env.ALLOW_LOCAL_EMBEDDING_GENERATION === 'true';
  
  // Allow running in development mode (local/Docker)
  if (!isProduction && !allowLocal) {
    console.log('⚠️  Running in development mode');
    console.log('   To suppress this warning, set ALLOW_LOCAL_EMBEDDING_GENERATION=true');
    console.log('   Current NODE_ENV:', process.env.NODE_ENV || 'not set');
    console.log('   Continuing with embedding generation...\n');
  }

  const forceRegenerate = process.argv.includes('--force');
  
  if (forceRegenerate) {
    console.log('⚠️  Force mode enabled: Will regenerate embeddings for ALL active products\n');
  }

  console.log(`🌍 Environment: ${isProduction ? 'PRODUCTION' : 'LOCAL (test mode)'}\n`);

  try {
    await generateEmbeddingsForProducts(forceRegenerate);
    console.log('\n✅ Embedding generation completed successfully!');
  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

