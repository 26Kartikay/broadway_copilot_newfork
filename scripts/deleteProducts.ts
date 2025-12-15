/**
 * Product Deletion Script
 * 
 * Deletes all products from the database.
 * 
 * Usage:
 *   npx ts-node scripts/deleteProducts.ts
 *   npx ts-node scripts/deleteProducts.ts --confirm
 * 
 * WARNING: This will permanently delete ALL products and their embeddings!
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteAllProducts() {
  console.log('🗑️  Starting product deletion...');
  
  // Count products first
  const count = await prisma.product.count();
  console.log(`📊 Found ${count} products in database`);
  
  if (count === 0) {
    console.log('✅ No products to delete.');
    return;
  }
  
  // Check for confirmation flag
  const args = process.argv.slice(2);
  const confirmed = args.includes('--confirm');
  
  if (!confirmed) {
    console.log('\n⚠️  WARNING: This will delete ALL products from the database!');
    console.log('⚠️  To confirm, run: npx ts-node scripts/deleteProducts.ts --confirm');
    console.log('⚠️  Aborting for safety...');
    return;
  }
  
  console.log('\n🗑️  Deleting all products...');
  
  try {
    // Delete all products (this will also cascade delete related records if any)
    const result = await prisma.product.deleteMany({});
    
    console.log(`✅ Successfully deleted ${result.count} products`);
    console.log('✅ Database cleared and ready for new imports');
  } catch (err) {
    console.error('❌ Error deleting products:', err);
    throw err;
  }
}

async function main() {
  try {
    await deleteAllProducts();
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

