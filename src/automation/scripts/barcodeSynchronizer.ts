import 'dotenv/config';
import { prisma } from '../../lib/prisma';
import { syncBarcodes } from '../services/barcodeService';

async function main() {
  console.log('[BarcodeSync] Starting barcode synchronizer...');
  try {
    const result = await syncBarcodes();
    console.log('[BarcodeSync] Complete:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('[BarcodeSync] Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
