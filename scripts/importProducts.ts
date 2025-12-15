/**
 * Product Import Script
 * 
 * Imports products from CSV into the database with vector embeddings.
 * 
 * Usage:
 *   npx ts-node scripts/importProducts.ts --file=products.csv
 *   npx ts-node scripts/importProducts.ts --file=products.json
 * 
 * Required CSV columns:
 *   - handle_id: Unique product identifier
 *   - barcode: Product barcode/SKU
 *   - article_name: Product name
 *   - brand: Brand name
 *   - general_tags: Product type tags (T-shirt, Oversized, Casual, etc.)
 *   - category: Main category (Clothing & Fashion, Beauty & Personal Care, etc.)
 *   - component_tags: Tags string (e.g., "STYLE (Aesthetic Identity): Athleisure, COLOR PREFERENCES: Black")
 *   - images: Product image URL
 *   - product_url: Link to product page
 * 
 * Optional columns:
 *   - id: Auto-generated ID (ignored)
 *   - tagged_at: Timestamp (ignored)
 */

import 'dotenv/config';
import { PrismaClient, ProductCategory } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration
const BATCH_SIZE = 100; // Products per batch for embedding
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

// ============================================================================
// CATEGORY MAPPING
// ============================================================================

const CATEGORY_MAP: Record<string, ProductCategory> = {
  'Clothing & Fashion': 'CLOTHING_FASHION',
  'Clothing & STYLE': 'CLOTHING_FASHION',
  'Beauty & Personal Care': 'BEAUTY_PERSONAL_CARE',
  'Beauty & F': 'BEAUTY_PERSONAL_CARE',
  'Health & Wellness': 'HEALTH_WELLNESS',
  'Health & V': 'HEALTH_WELLNESS',
  'Jewellery & Accessories': 'JEWELLERY_ACCESSORIES',
  'Footwear': 'FOOTWEAR',
  'Bags & Luggage': 'BAGS_LUGGAGE',
};

// ============================================================================
// COMPONENT PARSER
// ============================================================================

interface ParsedComponent {
  style?: string;
  fit?: string;
  colors: string[];
  patterns?: string;
  occasions: string[];
  allTags: Record<string, string | string[]>;
}

/**
 * Parses the component string into structured fields.
 * 
 * Input: "STYLE (Aesthetic Identity): Athleisure, FIT / SILHOUETTE: Oversized, COLOR PREFERENCES: Black, PATTERNS: Graphics, OCCASION: Casual"
 * Output: { style: "Athleisure", fit: "Oversized", colors: ["Black"], patterns: "Graphics", occasions: ["Casual"], allTags: {...} }
 */
function parseComponent(component: string): ParsedComponent {
  const result: ParsedComponent = {
    colors: [],
    occasions: [],
    allTags: {},
  };

  if (!component || typeof component !== 'string') {
    return result;
  }

  // Split by comma, but be careful with values that might contain commas
  const pairs = component.split(/,\s*(?=[A-Z])/);

  for (const pair of pairs) {
    const colonIndex = pair.indexOf(':');
    if (colonIndex === -1) continue;

    const key = pair.substring(0, colonIndex).trim();
    const value = pair.substring(colonIndex + 1).trim();

    if (!key || !value) continue;

    // Store in allTags
    result.allTags[key] = value;

    // Map to structured fields
    const keyLower = key.toLowerCase();

    if (keyLower.includes('style') || keyLower.includes('aesthetic')) {
      result.style = value;
    } else if (keyLower.includes('fit') || keyLower.includes('silhouette')) {
      result.fit = value;
    } else if (keyLower.includes('color')) {
      // Colors might be comma-separated within the value
      result.colors = value.split(/[,&]/).map(c => c.trim()).filter(Boolean);
    } else if (keyLower.includes('pattern')) {
      result.patterns = value;
    } else if (keyLower.includes('occasion')) {
      result.occasions = value.split(/[,&]/).map(o => o.trim()).filter(Boolean);
    }
  }

  return result;
}

// ============================================================================
// SEARCH DOCUMENT BUILDER
// ============================================================================

interface ProductData {
  handleId: string;
  barcode?: string;
  name: string;
  brand: string;
  category: ProductCategory;
  generalTag: string;
  style?: string;
  fit?: string;
  colors: string[];
  patterns?: string;
  occasions: string[];
  componentTags: Record<string, string | string[]>;
  imageUrl: string;
  productLink: string;
}

/**
 * Builds a search document for embedding generation.
 * Combines all relevant product information into a single string.
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

  // Add any additional tags from componentTags
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

  return parts.join('. ');
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

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

// ============================================================================
// CSV PARSER
// ============================================================================

/**
 * Simple CSV parser that handles quoted fields.
 */
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

interface RawProduct {
  handle_id: string;
  barcode?: string;
  article_name: string;
  brand: string;
  general_tags: string;      // Changed: was general_tag
  category: string;
  component_tags: string;    // Changed: was component
  tagged_at?: string;        // New: optional timestamp
  images: string;            // Changed: was image_url
  product_url: string;       // Changed: was product_link
}

async function importProducts(filePath: string, clearExisting: boolean = false) {
  console.log(`📦 Starting product import from: ${filePath}`);
  
  // Clear existing products if requested
  if (clearExisting) {
    console.log('🗑️  Clearing existing products...');
    const deleted = await prisma.product.deleteMany({});
    console.log(`✅ Deleted ${deleted.count} existing products`);
  }

  // Read file
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  
  // Parse based on file extension
  let rawProducts: RawProduct[];
  if (filePath.endsWith('.json')) {
    rawProducts = JSON.parse(content);
  } else {
    rawProducts = parseCSV(content) as unknown as RawProduct[];
  }

  console.log(`📋 Found ${rawProducts.length} products to import`);

  // Process in batches
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < rawProducts.length; i += BATCH_SIZE) {
    const batch = rawProducts.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(rawProducts.length / BATCH_SIZE);

    console.log(`\n🔄 Processing batch ${batchNum}/${totalBatches} (${batch.length} products)`);

    try {
      // Transform raw products to structured format
      const products: ProductData[] = [];
      const seenHandleIds = new Set<string>(); // Track duplicates within batch
      
      for (const raw of batch) {
        // Skip if missing required fields
        if (!raw.handle_id || !raw.article_name || !raw.brand) {
          console.warn(`⚠️ Skipping product with missing required fields: ${raw.handle_id || 'unknown'}`);
          skipped++;
          continue;
        }

        // Check for duplicates within the batch
        if (seenHandleIds.has(raw.handle_id)) {
          console.log(`⏭️ Skipping duplicate handleId in batch: ${raw.handle_id}`);
          skipped++;
          continue;
        }
        seenHandleIds.add(raw.handle_id);

        // Check if product already exists (only if not clearing)
        if (!clearExisting) {
          const existing = await prisma.product.findUnique({
            where: { handleId: raw.handle_id },
          });

          if (existing) {
            console.log(`⏭️ Skipping existing product: ${raw.handle_id}`);
            skipped++;
            continue;
          }
        }

        // Parse component_tags string
        const parsed = parseComponent(raw.component_tags || '');

        // Map category
        const category = CATEGORY_MAP[raw.category] || 'CLOTHING_FASHION';

        products.push({
          handleId: raw.handle_id,
          barcode: raw.barcode || undefined,
          name: raw.article_name,
          brand: raw.brand,
          category,
          generalTag: raw.general_tags || 'Unknown',
          style: parsed.style,
          fit: parsed.fit,
          colors: parsed.colors,
          patterns: parsed.patterns,
          occasions: parsed.occasions,
          componentTags: parsed.allTags,
          imageUrl: raw.images || '',
          productLink: raw.product_url || '',
        });
      }

      if (products.length === 0) {
        continue;
      }

      // Build search documents
      const searchDocs = products.map(buildSearchDoc);

      // Generate embeddings
      console.log(`🧠 Generating embeddings for ${products.length} products...`);
      const embeddings = await generateEmbeddings(searchDocs);

      // Insert into database
      console.log(`💾 Inserting ${products.length} products into database...`);
      
      for (let j = 0; j < products.length; j++) {
        const product = products[j];
        const embedding = embeddings[j];
        const searchDoc = searchDocs[j];

        try {
          // Use upsert to handle race conditions or if product was added between check and insert
          const created = await prisma.product.upsert({
            where: { handleId: product.handleId },
            update: {
              // Update all fields in case product already exists
              barcode: product.barcode,
              name: product.name,
              brand: product.brand,
              category: product.category,
              generalTag: product.generalTag,
              style: product.style,
              fit: product.fit,
              colors: product.colors,
              patterns: product.patterns,
              occasions: product.occasions,
              componentTags: product.componentTags,
              imageUrl: product.imageUrl,
              productLink: product.productLink,
              searchDoc,
              embeddingModel: EMBEDDING_MODEL,
              embeddingDim: EMBEDDING_DIM,
              embeddingAt: new Date(),
            },
            create: {
              handleId: product.handleId,
              barcode: product.barcode,
              name: product.name,
              brand: product.brand,
              category: product.category,
              generalTag: product.generalTag,
              style: product.style,
              fit: product.fit,
              colors: product.colors,
              patterns: product.patterns,
              occasions: product.occasions,
              componentTags: product.componentTags,
              imageUrl: product.imageUrl,
              productLink: product.productLink,
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
            created.id
          );

          imported++;
        } catch (err: any) {
          // Handle unique constraint errors gracefully
          if (err?.code === 'P2002' && err?.meta?.target?.includes('handleId')) {
            console.log(`⏭️ Skipping duplicate product (race condition): ${product.handleId}`);
            skipped++;
          } else {
            console.error(`❌ Error inserting product ${product.handleId}:`, err);
            errors++;
          }
        }
      }

      console.log(`✅ Batch ${batchNum} complete: ${products.length} processed`);

      // Rate limiting for OpenAI API
      if (i + BATCH_SIZE < rawProducts.length) {
        console.log('⏳ Waiting 1 second for rate limiting...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (err) {
      console.error(`❌ Error processing batch ${batchNum}:`, err);
      errors += batch.length;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 IMPORT SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Imported: ${imported}`);
  console.log(`⏭️ Skipped:  ${skipped}`);
  console.log(`❌ Errors:   ${errors}`);
  console.log(`📦 Total:    ${rawProducts.length}`);
  console.log('='.repeat(50));
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find(arg => arg.startsWith('--file='));
  const clearFlag = args.includes('--clear');

  if (!fileArg) {
    console.error('Usage: npx ts-node scripts/importProducts.ts --file=products.csv [--clear]');
    console.error('  --file=path/to/file.csv  : Path to CSV or JSON file');
    console.error('  --clear                  : Delete all existing products before importing');
    process.exit(1);
  }

  const filePath = fileArg.replace('--file=', '');

  if (clearFlag) {
    console.log('⚠️  WARNING: --clear flag detected. All existing products will be deleted!');
  }

  try {
    await importProducts(filePath, clearFlag);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

