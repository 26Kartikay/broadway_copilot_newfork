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
import { PrismaClient } from '@prisma/client';
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
  brand: string;
  category: string;
  generalTag: string;
  style: string | null;
  fit: string | null;
  colors: string[];
  patterns: string | null;
  occasions: string[];
  componentTags: any;
  description: string | null;
  searchDoc?: string | null; // Optional, will be regenerated
}

/**
 * Builds a search document for embedding generation.
 * This matches the logic from importProducts.ts
 */
function buildSearchDoc(product: ProductData): string {
  const parts: string[] = [
    product.name,
    `Brand: ${product.brand}`,
    `Type: ${product.generalTag}`,
  ];

  if (product.style) {
    parts.push(`Style: ${product.style}`);
  }
  if (product.fit) {
    parts.push(`Fit: ${product.fit}`);
  }
  if (product.colors.length > 0) {
    parts.push(`Colors: ${product.colors.join(', ')}`);
  }
  if (product.patterns) {
    parts.push(`Pattern: ${product.patterns}`);
  }
  if (product.occasions.length > 0) {
    parts.push(`Occasions: ${product.occasions.join(', ')}`);
  }

  // Add description if available
  if (product.description && product.description.trim()) {
    parts.push(`Description: ${product.description.trim()}`);
  }

  // Add any additional tags from componentTags
  if (product.componentTags && typeof product.componentTags === 'object') {
    for (const [key, value] of Object.entries(product.componentTags)) {
      const normalizedKey = key.toLowerCase();
      // Skip keys we've already processed
      if (
        normalizedKey.includes('style') ||
        normalizedKey.includes('fit') ||
        normalizedKey.includes('color') ||
        normalizedKey.includes('pattern') ||
        normalizedKey.includes('occasion')
      ) {
        continue;
      }
      const valueStr = Array.isArray(value) ? value.join(', ') : value;
      parts.push(`${key}: ${valueStr}`);
    }
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
  const whereClause = forceRegenerate 
    ? { isActive: true } 
    : { 
        isActive: true,
        OR: [
          { embedding: null },
          { embeddingModel: { not: EMBEDDING_MODEL } },
        ],
      };

  const totalProducts = await prisma.product.count({ where: whereClause });
  
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
      const products = await prisma.product.findMany({
      where: whereClause,
      take: BATCH_SIZE,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        brand: true,
        category: true,
        generalTag: true,
        style: true,
        fit: true,
        colors: true,
        patterns: true,
        occasions: true,
        componentTags: true,
        description: true,
      },
    });

    if (products.length === 0) {
      break;
    }

    console.log(`\n🔄 Processing batch ${Math.floor(offset / BATCH_SIZE) + 1}/${Math.ceil(totalProducts / BATCH_SIZE)} (${products.length} products)`);

    // Build search documents
    const searchDocs = products.map(product => buildSearchDoc(product as any));

    try {
      // Generate embeddings
      console.log(`🧠 Generating embeddings...`);
      const embeddings = await generateEmbeddings(searchDocs);

      // Update products with embeddings
      console.log(`💾 Updating products with embeddings...`);
      
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const embedding = embeddings[i];
        const searchDoc = searchDocs[i];

        try {
          // Update searchDoc first
          await prisma.product.update({
            where: { id: product.id },
            data: {
              searchDoc,
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
          console.error(`❌ Error updating product ${product.handleId}: ${err.message}`);
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

