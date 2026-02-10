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
  name: string;
  brandName: string;
  gender?: Gender | null; // Added
  ageGroup?: AgeGroup | null; // Added
  description?: string | null; // Added
  imageUrl?: string | null; // Made optional
  colors: string[];
}

/**
 * Builds a search document for embedding generation.
 */
function buildSearchDoc(product: ProductData): string {
  const parts: string[] = [
    product.name,
    `Brand: ${product.brandName}`,
  ];

  if (product.gender) {
    parts.push(`Gender: ${product.gender}`);
  }
  if (product.ageGroup) {
    parts.push(`Age Group: ${product.ageGroup}`);
  }
  if (product.description) {
    parts.push(`Description: ${product.description}`);
  }
  if (product.colors && product.colors.length > 0) {
    parts.push(`Colors: ${product.colors.join(', ')}`);
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
    totalProducts = await prisma.product.count({ where: { isActive: true } });
  } else {
    // Use raw SQL to count products without embeddings or with wrong model
    const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM "Product" 
       WHERE "isActive" = true 
       AND ("embedding" IS NULL OR "embeddingModel" IS NULL OR "embeddingModel" != $1)`,
      EMBEDDING_MODEL
    );
    totalProducts = Number(result[0].count);
  }
  
  // Check if there are any products at all
  const totalProductsInDb = await prisma.product.count({ where: { isActive: true } });
  
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

  // Process in batches
  for (let offset = 0; offset < totalProducts; offset += BATCH_SIZE) {
      // Use raw SQL to query products (embedding field is Unsupported type, can't filter with Prisma)
      let products: Array<{
        id: string;
        name: string;
        brandName: string;
        gender: Gender | null;
        ageGroup: AgeGroup | null;
        description: string | null;
        imageUrl: string | null;
        colors: string[];
      }>;

      if (forceRegenerate) {
        // Get all active products using Prisma
        products = await prisma.product.findMany({
          where: { isActive: true },
          take: BATCH_SIZE,
          skip: offset,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            brandName: true,
            gender: true,
            ageGroup: true,
            description: true,
            imageUrl: true,
            colors: true,
          },
        });
      } else {
        // Use raw SQL to get products without embeddings or with wrong model
        products = await prisma.$queryRawUnsafe<typeof products>(
                `SELECT id, name, "brandName", gender, "ageGroup", description, "imageUrl", colors
                 FROM "Product"
                 WHERE "isActive" = true 
                 AND ("embedding" IS NULL OR "embeddingModel" IS NULL OR "embeddingModel" != $1)
                 ORDER BY "createdAt" DESC
                 LIMIT $2 OFFSET $3`,          EMBEDDING_MODEL,
          BATCH_SIZE,
          offset
        );
      }

    if (products.length === 0) {
      break;
    }

    console.log(`\n🔄 Processing batch ${Math.floor(offset / BATCH_SIZE) + 1}/${Math.ceil(totalProducts / BATCH_SIZE)} (${products.length} products)`);

      // Build search documents - ensure all products have valid search docs
      const searchDocs: string[] = [];
      const validProducts: typeof products = [];
      
      for (const product of products) {
        if (!product) continue;
        const searchDoc = buildSearchDoc(product as any);
        if (searchDoc && searchDoc.trim().length > 0) {
          searchDocs.push(searchDoc);
          validProducts.push(product);
        }
      }

      if (validProducts.length === 0) {
        console.log('⚠️ No valid products in this batch, skipping...');
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
      if (offset + BATCH_SIZE < totalProducts) {
        console.log('⏳ Waiting 1 second for rate limiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
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
  
  if (!isProduction && !allowLocal) {
    console.error('❌ This script is designed to run in production only.');
    console.error('   To run locally (for testing), set ALLOW_LOCAL_EMBEDDING_GENERATION=true');
    console.error('   Current NODE_ENV:', process.env.NODE_ENV || 'not set');
    process.exit(1);
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

