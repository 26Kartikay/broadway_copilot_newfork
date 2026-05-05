import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import { automationConfig } from '../../lib/automation/config';
import {
  barcodeColumnSpecified,
  loadBulkCatalogMapping,
  rowToSeedProductInput,
  type BulkCatalogMappingFile,
  type SeedRowProductInput,
} from '../../lib/automation/bulkCatalogMapping';
import {
  loadCatalogTaxonomyJson,
  resolveTaxonomyFilePath,
  type CatalogTaxonomyIndex,
} from '../../lib/automation/catalogTaxonomy';
import { bulkApplyTags, bulkUpsertProducts } from '../../lib/automation/bulkCatalogDb';
import { runDbOnlyEmbeddingPipeline } from '../../lib/automation/dbEmbeddingRunner';
import { runOpenAiTagAndEmbedPipeline } from '../../lib/automation/llmTagEmbedRunner';
import { prisma } from '../../lib/prisma';

function parseArgs(argv: string[]) {
  let csvPath: string | undefined;
  let mappingPath: string | undefined;
  let seed = false;
  let tag = false;
  let embed = false;
  let maxProducts = automationConfig.maxPerRun;
  let concurrency = automationConfig.concurrency;
  /** When true, embedding step only processes embeddingStatus=pending (default). False → pending + failed. */
  let embedPendingOnly = true;
  let resetEmbeddingOnSeed = true;
  /** Use OpenAI (same as API orchestrator tagExtractor) for tags + embeddings; omit for CSV-only tags. */
  let llmTags = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--csv') {
      csvPath = argv[++i];
    } else if (a === '--mapping') {
      mappingPath = argv[++i];
    } else if (a === '--seed') seed = true;
    else if (a === '--tag') tag = true;
    else if (a === '--embed') embed = true;
    else if (a === '--max') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!Number.isNaN(n)) maxProducts = n;
    } else if (a === '--concurrency') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!Number.isNaN(n)) concurrency = n;
    } else if (a === '--no-reset-embedding') resetEmbeddingOnSeed = false;
    else if (a === '--retry-failed-embed') embedPendingOnly = false;
    else if (a === '--llm-tags') llmTags = true;
  }

  if (!seed && !tag && !embed && csvPath) {
    seed = true;
    tag = true;
    embed = true;
  }

  return {
    csvPath,
    mappingPath: mappingPath ?? path.resolve(process.cwd(), 'files/catalogTaxonomy.json'),
    seed,
    tag,
    embed,
    maxProducts,
    concurrency,
    embedPendingOnly,
    resetEmbeddingOnSeed,
    llmTags,
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

function dedupeByBarcode(
  rows: Record<string, unknown>[],
  mapping: BulkCatalogMappingFile,
  applyTags: boolean,
  taxonomy: CatalogTaxonomyIndex | undefined,
): SeedRowProductInput[] {
  const map = new Map<string, SeedRowProductInput>();
  for (const row of rows) {
    const input = rowToSeedProductInput(row, mapping, applyTags, taxonomy);
    if (input) map.set(input.barcode, input);
  }
  return [...map.values()];
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  console.log('[BulkCatalogSync] Steps:', {
    seed: args.seed,
    tag: args.tag,
    embed: args.embed,
    llmTags: args.embed ? args.llmTags : false,
    mapping: args.mappingPath,
    csv: args.csvPath ?? '(embed-only)',
  });

  if ((args.seed || args.tag) && !args.csvPath) {
    console.error('Usage: --csv <file.csv> --mapping <mapping.json> [--seed] [--tag] [--embed]\n' +
      '  Omit step flags with --csv to run seed+tag+embed.\n' +
      '  Example CSV columns (see files/catalogTaxonomy.json _bulkCatalog.columnMap): id, barcode, name, description, primary_image_url, brand\n' +
      '  --embed alone: pending products from DB → embed (CSV/DB tags by default; add --llm-tags for OpenAI tags first). No Broadway API.\n' +
      '  --no-reset-embedding: on seed/update, do not force embeddingStatus back to pending.\n' +
      '  --retry-failed-embed: include failed rows in embed step.\n' +
      '  Mapping: files/catalogTaxonomy.json (taxonomy + optional _bulkCatalog columnMap) or files/mapping.example.json.\n' +
      '  Optional separate taxonomy via "taxonomyPath" relative to the mapping file.\n' +
      '  --llm-tags: embed step uses OpenAI tagExtractor + embeddings (same DB shape as API runProductAutomation).');
    return 1;
  }

  let mapping: BulkCatalogMappingFile | undefined;
  if (args.seed || args.tag) {
    if (!fs.existsSync(args.mappingPath)) {
      console.error(`Mapping not found: ${args.mappingPath} (use files/catalogTaxonomy.json or copy files/mapping.example.json)`);
      return 1;
    }
    mapping = loadBulkCatalogMapping(args.mappingPath);
    if (!barcodeColumnSpecified(mapping.columnMap.barcode)) {
      console.error('mapping.json columnMap.barcode is required (CSV header name or list, e.g. "barcode")');
      return 1;
    }
  }

  const mappingResolved = path.resolve(args.mappingPath);
  let taxonomy: CatalogTaxonomyIndex | undefined;
  if (mapping?.taxonomyPath?.trim()) {
    const taxPath = resolveTaxonomyFilePath(mappingResolved, mapping.taxonomyPath.trim());
    taxonomy = loadCatalogTaxonomyJson(taxPath);
    console.log(`[BulkCatalogSync] Loaded catalog taxonomy: ${taxPath}`);
  } else if (mapping?.taxonomyInline) {
    taxonomy = loadCatalogTaxonomyJson(mappingResolved);
    console.log(`[BulkCatalogSync] Loaded inline catalog taxonomy from ${mappingResolved}`);
  }

  if (args.seed && mapping && args.csvPath) {
    const resolved = path.resolve(args.csvPath);
    const data = parseCsvFile(resolved);
    const applyTagsInSeed = args.tag;
    const inputs = dedupeByBarcode(data, mapping, applyTagsInSeed, taxonomy);
    console.log(`[BulkCatalogSync] Seed: ${inputs.length} unique barcodes from ${resolved}`);
    const r = await bulkUpsertProducts(inputs, {
      resetEmbeddingQueue: args.resetEmbeddingOnSeed,
      markTagged: applyTagsInSeed,
    });
    console.log(`[BulkCatalogSync] Seed upsert: created ${r.created}, updated ${r.updated}`);
  }

  if (args.tag && mapping && args.csvPath && !args.seed) {
    const resolved = path.resolve(args.csvPath);
    const data = parseCsvFile(resolved);
    const inputs = dedupeByBarcode(data, mapping, true, taxonomy);
    console.log(`[BulkCatalogSync] Tag-only: ${inputs.length} rows`);
    const r = await bulkApplyTags(inputs);
    console.log(`[BulkCatalogSync] Tag updates: ${r.updated} products`);
  }

  if (args.embed) {
    const mode = args.llmTags ? 'OpenAI tag + embed (matches API orchestrator)' : 'DB tags + embed only';
    console.log(
      `[BulkCatalogSync] ${mode} — max=${args.maxProducts}, concurrency=${args.concurrency}…`,
    );
    const metrics = args.llmTags
      ? await runOpenAiTagAndEmbedPipeline({
          maxProducts: args.maxProducts,
          concurrency: args.concurrency,
          skipEmbedded: args.embedPendingOnly,
        })
      : await runDbOnlyEmbeddingPipeline({
          maxProducts: args.maxProducts,
          concurrency: args.concurrency,
          skipEmbedded: args.embedPendingOnly,
        });
    console.log(`\n=== EMBED SUMMARY (${args.llmTags ? 'OpenAI tags' : 'CSV/DB tags'}, no Broadway API) ===`);
    console.log(`Total tasks:  ${metrics.totalTasks}`);
    console.log(`Success:      ${metrics.successCount}`);
    console.log(`Failed:       ${metrics.failureCount}`);
    if (metrics.errors.length) {
      console.log('Sample errors:');
      metrics.errors.slice(0, 5).forEach((e) => console.log(`  ${e}`));
    }
    return metrics.failureCount > 0 && metrics.successCount === 0 ? 1 : 0;
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[BulkCatalogSync] Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
