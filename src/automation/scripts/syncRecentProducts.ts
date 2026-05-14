import 'dotenv/config';
import { prisma } from '../../lib/prisma';
import { syncRecentProducts } from '../services/recentProductService';

async function main() {
  console.log('[RecentProductSync] Starting manual synchronization...');
  try {
    const result = await syncRecentProducts();
    console.log('[RecentProductSync] Complete:', JSON.stringify(result, null, 2));
    
    if (result.newProducts > 0) {
      console.log(`
Found ${result.newProducts} new products. They are now in the queue for tagging/embedding.`);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('[RecentProductSync] Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
