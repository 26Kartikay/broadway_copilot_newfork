/**
 * Clear All Product Embeddings
 * 
 * Sets the embedding, embeddingModel, embeddingDim, and embeddingAt fields to NULL for all products.
 * This effectively "deletes" existing embeddings without removing product data.
 * 
 * Usage:
 *   npx ts-node scripts/clearEmbeddings.ts --confirm
 * 
 * WARNING: This will permanently remove embedding data for ALL products!
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearAllEmbeddings() {
  console.log('Starting to clear all product embeddings...');
  
  // Check for confirmation flag
  const args = process.argv.slice(2);
  const confirmed = args.includes('--confirm');
  
  if (!confirmed) {
    console.log('WARNING: This will permanently remove embedding data for ALL products!');
    console.log('To confirm, run: npx ts-node scripts/clearEmbeddings.ts --confirm');
    console.log('Aborting for safety...');
    return;
  }
  
  console.log('Clearing embedding data for all products...');
  
  try {
    // Use raw SQL to set embedding fields to NULL
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "Product" SET embedding = NULL, "embeddingModel" = NULL, "embeddingDim" = NULL, "embeddingAt" = NULL;`
    );
    
    console.log(`✅ Successfully cleared embedding data for ${result} products.`);
    console.log('✅ All product embeddings have been removed.');
  } catch (err) {
    console.error('❌ Error clearing embeddings:', err);
    throw err;
  }
}

async function main() {
  try {
    await clearAllEmbeddings();
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

