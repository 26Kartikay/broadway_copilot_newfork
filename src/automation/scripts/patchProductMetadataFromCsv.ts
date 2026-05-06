/**
 * Apply name + config_id (and other mapped CSV columns) to existing Product rows by barcode
 * without a full catalog re-import or re-tagging.
 *
 * Sets embeddingStatus=pending only when searchDoc or merged tags materially change
 * (same behavior as editing title/config would affect embeddings).
 *
 * Usage:
 *   npx ts-node --transpile-only src/automation/scripts/patchProductMetadataFromCsv.ts \\
 *     --csv ./files/productss.csv \\
 *     --mapping ./files/catalogTaxonomy.json \\
 *     [--limit N]           # only first N data rows from the CSV
 *     [--minimal]           # only merge name, csvConfigId, csvSkuId from CSV into componentTags; leave other DB columns as-is (no searchDoc rewrite)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import type { Prisma } from '@prisma/client';
import {
  cell,
  loadBulkCatalogMapping,
  rowToSeedProductInput,
  type BulkCatalogMappingFile,
} from '../../lib/automation/bulkCatalogMapping';
import {
  loadCatalogTaxonomyJson,
  resolveTaxonomyFilePath,
  type CatalogTaxonomyIndex,
} from '../../lib/automation/catalogTaxonomy';
import { prisma } from '../../lib/prisma';

function parseArgs(argv: string[]) {
  let csvPath: string | undefined;
  let mappingPath: string | undefined;
  let dryRun = false;
  let limit: number | undefined;
  let minimal = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--csv') csvPath = argv[++i];
    else if (a === '--mapping') mappingPath = argv[++i];
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--minimal') minimal = true;
    else if (a === '--limit' || a === '--max') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!Number.isNaN(n) && n > 0) limit = n;
    }
  }

  return {
    csvPath,
    mappingPath: mappingPath ?? path.resolve(process.cwd(), 'files/catalogTaxonomy.json'),
    dryRun,
    limit,
    minimal,
  };
}

function parseCsvFile(resolved: string): Record<string, unknown>[] {
  const file = fs.readFileSync(resolved, 'utf8');
  const firstLine = file.split(/\r?\n/)[0] ?? '';
  const delimiter =
    firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';

  const parsed = Papa.parse<Record<string, unknown>>(file, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: (h) => h.replace(/^\uFEFF/, '').replace(/\s+$/, '').trim(),
  });

  const fatalErrors = parsed.errors.filter((e) => e.code !== 'UndetectableDelimiter');
  if (fatalErrors.length > 0) {
    throw new Error(`CSV parse errors: ${JSON.stringify(fatalErrors)}`);
  }

  return parsed.data.filter((row) => Object.keys(row).some((k) => String(row[k] ?? '').trim()));
}

async function patchOneRowMinimal(
  row: Record<string, unknown>,
  mapping: BulkCatalogMappingFile,
  args: { dryRun: boolean },
): Promise<
  | { kind: 'skip'; reason: 'no_barcode' | 'nothing_to_apply' | 'missing_product' | 'unchanged' }
  | { kind: 'update'; needsEmbed: boolean; barcode: string; dryLine: string }
> {
  const m = mapping.columnMap;
  const barcode = cell(row, m.barcode);
  if (!barcode) return { kind: 'skip', reason: 'no_barcode' };

  const nameCsvRaw = cell(row, m.name).trim();
  const configCsvRaw = cell(row, m.configId).trim();
  const skuCsvRaw = cell(row, m.skuId).trim();
  if (!nameCsvRaw && !configCsvRaw && !skuCsvRaw) return { kind: 'skip', reason: 'nothing_to_apply' };

  const existing = await prisma.product.findFirst({
    where: { barcode },
    select: {
      id: true,
      name: true,
      componentTags: true,
    },
  });
  if (!existing) return { kind: 'skip', reason: 'missing_product' };

  const prevTags =
    existing.componentTags &&
    typeof existing.componentTags === 'object' &&
    !Array.isArray(existing.componentTags)
      ? (existing.componentTags as Record<string, unknown>)
      : {};

  const prevConfig = typeof prevTags.csvConfigId === 'string' ? prevTags.csvConfigId.trim() : '';
  const prevSku = typeof prevTags.csvSkuId === 'string' ? prevTags.csvSkuId.trim() : '';
  let mergedTags = { ...prevTags };
  let configApplied = false;
  let skuApplied = false;
  if (configCsvRaw && configCsvRaw !== prevConfig) {
    mergedTags = { ...mergedTags, csvConfigId: configCsvRaw };
    configApplied = true;
  }
  if (skuCsvRaw && skuCsvRaw !== prevSku) {
    mergedTags = { ...mergedTags, csvSkuId: skuCsvRaw };
    skuApplied = true;
  }

  const nextName = nameCsvRaw || existing.name;
  const nameChanged = Boolean(nameCsvRaw) && nextName !== existing.name;

  if (!configApplied && !skuApplied && !nameChanged) {
    return { kind: 'skip', reason: 'unchanged' };
  }

  /** Config is for dedupe; DB-only embed rebuilds doc from title/fields — only name changes force re-vector. */
  const needsEmbed = nameChanged;

  const dryLine = `[dry-run] ${barcode} name=${nameChanged} config=${configApplied} sku=${skuApplied} embed_pending=${needsEmbed}`;

  if (args.dryRun) {
    return { kind: 'update', needsEmbed, barcode, dryLine };
  }

  await prisma.product.update({
    where: { id: existing.id },
    data: {
      ...(nameChanged ? { name: nextName } : {}),
      componentTags: mergedTags as Prisma.InputJsonValue,
      ...(needsEmbed
        ? {
            embeddingStatus: 'pending',
            automationErrors: { set: [] },
          }
        : {}),
    },
  });

  return { kind: 'update', needsEmbed, barcode, dryLine };
}

function stableJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return JSON.stringify(obj);
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = o[k];
  return JSON.stringify(sorted);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csvPath) {
    console.error(
      'Usage: patchProductMetadataFromCsv --csv <file.csv> [--mapping mapping.json] [--limit N] [--minimal] [--dry-run]\n' +
        '  Uses the same bulk mapping as automation:bulk-sync; rows keyed by barcode.\n' +
        '  --limit N: process only the first N data rows from the CSV.\n' +
        '  --minimal: merges name, csvConfigId, csvSkuId into componentTags (+ name column if provided; does not rewrite searchDoc).',
    );
    return 1;
  }

  const resolvedCsv = path.resolve(args.csvPath);
  if (!fs.existsSync(resolvedCsv)) {
    console.error(`File not found: ${resolvedCsv}`);
    return 1;
  }

  const mappingResolved = path.resolve(args.mappingPath);
  if (!fs.existsSync(mappingResolved)) {
    console.error(`Mapping not found: ${mappingResolved}`);
    return 1;
  }

  const mapping = loadBulkCatalogMapping(mappingResolved);

  let taxonomy: CatalogTaxonomyIndex | undefined;
  if (mapping.taxonomyPath?.trim()) {
    const taxPath = resolveTaxonomyFilePath(mappingResolved, mapping.taxonomyPath.trim());
    taxonomy = loadCatalogTaxonomyJson(taxPath);
  } else if (mapping.taxonomyInline) {
    taxonomy = loadCatalogTaxonomyJson(mappingResolved);
  }

  const allRows = parseCsvFile(resolvedCsv);
  const totalInFile = allRows.length;
  let rows = allRows;
  if (args.limit != null) {
    rows = allRows.slice(0, args.limit);
    console.log(
      `[patchProductMetadata] --limit ${args.limit}: using ${rows.length} of ${totalInFile} CSV rows`,
    );
  }

  let updated = 0;
  let skippedNoBarcode = 0;
  let skippedMissingProduct = 0;
  let skippedNothingToApply = 0;
  let unchanged = 0;
  let pendingEmbed = 0;

  const applyTags = Boolean(taxonomy) && !args.minimal;

  for (const row of rows) {
    if (args.minimal) {
      const res = await patchOneRowMinimal(row, mapping, { dryRun: args.dryRun });
      if (res.kind === 'skip') {
        if (res.reason === 'no_barcode') skippedNoBarcode++;
        else if (res.reason === 'missing_product') skippedMissingProduct++;
        else if (res.reason === 'nothing_to_apply') skippedNothingToApply++;
        else unchanged++;
        continue;
      }
      if (args.dryRun && res.dryLine) console.log(res.dryLine);
      updated++;
      if (res.needsEmbed) pendingEmbed++;
      continue;
    }

    const input = rowToSeedProductInput(row, mapping, applyTags, taxonomy);
    if (!input) {
      skippedNoBarcode++;
      continue;
    }

    const existing = await prisma.product.findFirst({
      where: { barcode: input.barcode },
      select: {
        id: true,
        name: true,
        searchDoc: true,
        componentTags: true,
      },
    });

    if (!existing) {
      skippedMissingProduct++;
      continue;
    }

    const prevTags =
      existing.componentTags &&
      typeof existing.componentTags === 'object' &&
      !Array.isArray(existing.componentTags)
        ? (existing.componentTags as Record<string, unknown>)
        : {};
    const mergedTags: Record<string, unknown> = { ...prevTags, ...input.componentTags };

    const tagsChanged = stableJson(mergedTags) !== stableJson(prevTags);
    const nameChanged = existing.name !== input.name;
    const searchDocChanged = existing.searchDoc !== input.searchDoc;

    if (!tagsChanged && !nameChanged && !searchDocChanged) {
      unchanged++;
      continue;
    }

    const needsEmbed = searchDocChanged || nameChanged;

    if (args.dryRun) {
      console.log(
        `[dry-run] ${input.barcode} name=${nameChanged} searchDoc=${searchDocChanged} tags=${tagsChanged} embed=${needsEmbed}`,
      );
      updated++;
      if (needsEmbed) pendingEmbed++;
      continue;
    }

    await prisma.product.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        searchDoc: input.searchDoc,
        componentTags: mergedTags as Prisma.InputJsonValue,
        ...(needsEmbed
          ? {
              embeddingStatus: 'pending',
              automationErrors: { set: [] },
            }
          : {}),
      },
    });
    updated++;
    if (needsEmbed) pendingEmbed++;
  }

  console.log(
    `[patchProductMetadata] mode=${args.minimal ? 'minimal' : 'full'} csv_rows=${rows.length}${args.limit != null ? ` (of ${totalInFile} in file)` : ''} updated=${updated} unchanged=${unchanged} ` +
      `skip_no_barcode=${skippedNoBarcode} skip_missing_product=${skippedMissingProduct} skip_empty_row=${skippedNothingToApply} ` +
      `rows_needing_embed=${pendingEmbed}${args.dryRun ? ' (dry-run)' : ''}`,
  );
  if (pendingEmbed > 0 && !args.dryRun) {
    console.log(
      '[patchProductMetadata] Run embedding for pending rows only, e.g. automation:bulk-sync --embed --no-reset-embedding … or your db embedding runner with maxProducts.',
    );
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
