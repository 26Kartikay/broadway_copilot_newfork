/**
 * Clear Embeddings Script
 * 
 * Clears all embeddings from products while keeping the products themselves.
 * 
 * Usage:
 *   npx ts-node scripts/clearEmbeddings.ts
 *   npx ts-node scripts/clearEmbeddings.ts --confirm
 * 
 * WARNING: This will permanently delete ALL embeddings from products!
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearAllEmbeddings() {
  console.log('🗑️  Starting embedding deletion...');
  
  // Count products with embeddings first
  const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) as count FROM "Product" WHERE "embedding" IS NOT NULL`
  );
  const count = Number(result[0].count);
  
  console.log(`📊 Found ${count} products with embeddings`);
  
  if (count === 0) {
    console.log('✅ No embeddings to delete.');
    return;
  }
  
  // Check for confirmation flag
  const args = process.argv.slice(2);
  const confirmed = args.includes('--confirm');
  
  if (!confirmed) {
    console.log('\n⚠️  WARNING: This will delete ALL embeddings from products!');
    console.log('⚠️  Products will remain, but embeddings will be cleared.');
    console.log('⚠️  To confirm, run: npx ts-node scripts/clearEmbeddings.ts --confirm');
    console.log('⚠️  Aborting for safety...');
    return;
  }
  
  console.log('\n🗑️  Clearing all embeddings...');
  
  try {
    // Clear embeddings using raw SQL (Prisma doesn't support vector type directly)
    await prisma.$executeRawUnsafe(
      `UPDATE "Product" SET embedding = NULL, "embeddingModel" = NULL, "embeddingDim" = NULL, "embeddingAt" = NULL`
    );
    
    console.log(`✅ Successfully cleared embeddings from ${count} products`);
    console.log('✅ Products remain in database, ready for re-embedding');
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


