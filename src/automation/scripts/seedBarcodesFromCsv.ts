import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import { ProductCategory } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../../lib/prisma';
import { runProductAutomation } from '../../lib/automation/orchestrator';
import { automationConfig } from '../../lib/automation/config';
import { linkAvailableBarcodesToProducts } from '../services/barcodeService';

function hashBarcodeToExternalId(barcode: string): number {
  let h = 0;
  for (let i = 0; i < barcode.length; i++) {
    h = (Math.imul(31, h) + barcode.charCodeAt(i)) | 0;
  }
  const n = Math.abs(h) % 2147483647;
  return n === 0 ? 1 : n;
}

/** Stable unique handle for seeded rows (Product.handleId is unique). */
function handleForSeedBarcode(barcode: string): string {
  const safe = barcode
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const base = `seed-${safe || 'x'}`;
  return base.length > 120 ? base.slice(0, 120) : base;
}

const PLACEHOLDER_SEARCH_DOC = 'Pending catalog enrichment';

async function upsertProductStubsForBarcodes(
  uniqueBarcodes: string[],
): Promise<{ created: number; requeued: number }> {
  let created = 0;
  let requeued = 0;
  const BATCH = 300;

  for (let i = 0; i < uniqueBarcodes.length; i += BATCH) {
    const chunk = uniqueBarcodes.slice(i, i + BATCH);
    console.log(
      `[SeedBarcodes] Product stubs batch ${Math.min(i + BATCH, uniqueBarcodes.length)}/${uniqueBarcodes.length}…`,
    );

    const found = await prisma.product.findMany({
      where: { barcode: { in: chunk } },
      select: { barcode: true },
    });
    const haveBarcode = new Set(
      found.map((f) => f.barcode).filter((b): b is string => b != null && b !== ''),
    );

    const missing = chunk.filter((b) => !haveBarcode.has(b));
    const existingBarcodes = chunk.filter((b) => haveBarcode.has(b));

    if (existingBarcodes.length > 0) {
      const u = await prisma.product.updateMany({
        where: { barcode: { in: existingBarcodes } },
        data: {
          embeddingStatus: 'pending',
          isActive: true,
          automationErrors: [],
        },
      });
      requeued += u.count;
    }

    if (missing.length > 0) {
      await prisma.product.createMany({
        data: missing.map((barcode) => ({
          handleId: `${handleForSeedBarcode(barcode)}-${createId().slice(0, 8)}`,
          barcode,
          name: `Product ${barcode}`,
          brand: 'Unknown',
          category: ProductCategory.CLOTHING_FASHION,
          generalTag: 'Product',
          componentTags: {},
          colors: [] as string[],
          occasions: [] as string[],
          imageUrl: '',
          productLink: '',
          searchDoc: `${PLACEHOLDER_SEARCH_DOC} ${barcode}`,
          embeddingStatus: 'pending',
          isActive: true,
        })),
      });
      created += missing.length;
    }
  }

  return { created, requeued };
}

function parseArgs(argv: string[]) {
  const skipAutomation = argv.includes('--skip-automation');
  let maxProducts = automationConfig.maxPerRun;
  const maxIdx = argv.indexOf('--max');
  if (maxIdx >= 0) {
    const rawMax = argv[maxIdx + 1];
    if (rawMax) {
      const n = parseInt(rawMax, 10);
      if (!Number.isNaN(n)) maxProducts = n;
    }
  }
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--skip-automation') continue;
    if (a === '--max') {
      i += 1;
      continue;
    }
    if (!a.startsWith('--')) positional.push(a);
  }
  const csvPath = positional[0];
  return { csvPath, skipAutomation, maxProducts };
}

async function seedBarcodes(barcodes: string[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  const BATCH = 500;
  const n = barcodes.length;
  console.log(`[SeedBarcodes] Syncing ${n} rows to AvailableBarcode (batched)…`);

  for (let i = 0; i < n; i += BATCH) {
    const chunk = barcodes.slice(i, i + BATCH);
    const existing = await prisma.availableBarcode.findMany({
      where: { barcode: { in: chunk } },
      select: { barcode: true },
    });
    const have = new Set(existing.map((e) => e.barcode));
    const toCreate = chunk.filter((b) => !have.has(b));
    const toUpdate = chunk.filter((b) => have.has(b));

    if (toUpdate.length > 0) {
      const r = await prisma.availableBarcode.updateMany({
        where: { barcode: { in: toUpdate } },
        data: { lastChecked: new Date(), status: 'pending' },
      });
      updated += r.count;
    }
    if (toCreate.length > 0) {
      await prisma.availableBarcode.createMany({
        data: toCreate.map((barcode) => ({
          barcode,
          externalId: hashBarcodeToExternalId(barcode),
          name: `Seeded ${barcode}`,
          status: 'pending',
        })),
      });
      created += toCreate.length;
    }
    console.log(`[SeedBarcodes] AvailableBarcode progress ${Math.min(i + BATCH, n)}/${n}`);
  }

  return { created, updated };
}

function extractBarcodeColumn(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0] ?? {});
  const col = keys.find((k) => k.trim().toLowerCase() === 'barcodes');
  if (!col) {
    throw new Error(
      `CSV must include a "barcodes" column. Found columns: ${keys.join(', ') || '(none)'}`,
    );
  }
  const out: string[] = [];
  for (const row of rows) {
    const v = row[col];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) out.push(s);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const { csvPath, skipAutomation, maxProducts } = parseArgs(argv);

  if (!csvPath) {
    console.error(
      'Usage: seedBarcodesFromCsv <path-to.csv> [--max N] [--skip-automation]\n' +
        '  CSV: header column "barcodes", one SKU per row.\n' +
        '  Creates or updates Product rows (embeddingStatus=pending), syncs AvailableBarcode, links, then runs tagger+embedder.',
    );
    process.exit(1);
  }

  const resolved = path.resolve(csvPath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const file = fs.readFileSync(resolved, 'utf8');
  // Explicit delimiter avoids Papa's "UndetectableDelimiter" on small/one-column files.
  const firstLine = file.split(/\r?\n/)[0] ?? '';
  const delimiter =
    firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';

  const parsed = Papa.parse<Record<string, unknown>>(file, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: (h) => h.trim(),
  });

  const fatalErrors = parsed.errors.filter((e) => e.code !== 'UndetectableDelimiter');
  if (fatalErrors.length > 0) {
    console.error('CSV parse errors:', fatalErrors);
    process.exit(1);
  }
  if (parsed.errors.length > 0) {
    console.warn('[SeedBarcodes] CSV parse notes (non-fatal):', parsed.errors);
  }

  const barcodes = extractBarcodeColumn(parsed.data);
  const uniqueBarcodes = [...new Set(barcodes.map((b) => b.trim()).filter(Boolean))];
  console.log(
    `[SeedBarcodes] Parsed ${barcodes.length} rows (${uniqueBarcodes.length} unique barcodes) from ${resolved}`,
  );

  let t0 = Date.now();
  console.log('[SeedBarcodes] Step 1/4: upsert Product stubs…');
  const stubStats = await upsertProductStubsForBarcodes(uniqueBarcodes);
  console.log(
    `[SeedBarcodes] Products: created ${stubStats.created} stubs, re-queued ${stubStats.requeued} (${Date.now() - t0}ms)`,
  );

  t0 = Date.now();
  console.log('[SeedBarcodes] Step 2/4: sync AvailableBarcode table…');
  const { created, updated } = await seedBarcodes(uniqueBarcodes);
  console.log(
    `[SeedBarcodes] AvailableBarcode: created ${created}, updated ${updated} (${Date.now() - t0}ms)`,
  );

  t0 = Date.now();
  console.log('[SeedBarcodes] Step 3/4: link AvailableBarcode → Product (bulk SQL)…');
  const linked = await linkAvailableBarcodesToProducts();
  console.log(`[SeedBarcodes] Linked ${linked} rows (${Date.now() - t0}ms)`);

  if (skipAutomation) {
    console.log('[SeedBarcodes] Skipping product automation (--skip-automation)');
    process.exit(0);
    return;
  }

  t0 = Date.now();
  console.log(`[SeedBarcodes] Step 4/4: product tagger + embedder (max=${maxProducts})…`);
  const metrics = await runProductAutomation({
    maxProducts,
    skipEmbedded: false,
  });

  console.log(`[SeedBarcodes] Automation finished (${Date.now() - t0}ms)`);
  console.log('\n=== AUTOMATION SUMMARY ===');
  console.log(`Total tasks:  ${metrics.totalTasks}`);
  console.log(`Success:      ${metrics.successCount}`);
  console.log(`Failed:       ${metrics.failureCount}`);

  process.exit(metrics.failureCount > 0 && metrics.successCount === 0 ? 1 : 0);
}

main()
  .catch((err) => {
    console.error('[SeedBarcodes] Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
