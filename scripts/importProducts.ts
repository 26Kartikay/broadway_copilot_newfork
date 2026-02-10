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
 *   - barcode: Product barcode/SKU
 *   - name: Product name
 *   - brand name: Brand name
 *   - gender: Gender (MALE, FEMALE, OTHER) - optional
 *   - age: Age group (TEEN, ADULT, SENIOR) - optional
 *   - description: Product description - optional
 *   - image: Product image URL
 *   - color: Comma-separated list of colors - optional
 */

import 'dotenv/config';
import { PrismaClient, Gender, AgeGroup } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
// Removed OpenAI import as embeddings are no longer generated

const prisma = new PrismaClient();
// Removed openai client initialization

// Removed BATCH_SIZE, EMBEDDING_MODEL, EMBEDDING_DIM as they are no longer needed.

// Removed CATEGORY_MAP as category field is no longer in Product model.

// Removed ParsedComponent interface and parseComponent function as component_tags are no longer processed.

// ============================================================================
// PRODUCT DATA INTERFACES
// ============================================================================

interface ProductData {
  barcode: string;
  name: string;
  brandName: string;
  gender?: Gender;
  ageGroup?: AgeGroup;
  description: string;
  imageUrl: string;
  colors: string[];
}

// Removed buildSearchDoc function as searchDoc is no longer in Product model.

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
  barcode: string;
  name: string;
  'brand name': string; // Use string literal for column with space
  gender?: string;
  age?: string;
  description?: string;
  image: string;
  color?: string; // This will be a comma-separated string
}

async function importProducts(filePath: string, clearExisting: boolean = false) {
  // The filePath is already resolved to an absolute path by the main function.
  const absolutePath = filePath;

  console.log(`📦 Attempting to load file from: ${absolutePath}`);
  
  if (!fs.existsSync(absolutePath)) {
    const fallbackPath = path.resolve(process.cwd(), filePath);
    console.log(`trying fallback: ${fallbackPath}`);
    if(!fs.existsSync(fallbackPath)) throw new Error(`File not found at ${absolutePath} or ${fallbackPath}`);
  }
  
  // Clear existing products if requested
  if (clearExisting) {
    console.log('🗑️  Clearing existing products...');
    const deleted = await prisma.product.deleteMany({});
    console.log(`✅ Deleted ${deleted.count} existing products`);
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

  for (let i = 0; i < rawProducts.length; i++) { // Process one by one since no embeddings batching
    const raw = rawProducts[i];
    const productNum = i + 1;
    const totalProducts = rawProducts.length;

    console.log(`\n🔄 Processing product ${productNum}/${totalProducts}: ${raw.name || raw.barcode || 'unknown'}`);

    try {
      console.log('Raw data from CSV:', JSON.stringify(raw, null, 2));

      
      // Check for duplicates (within the entire set, as we're processing one by one)
      const existing = await prisma.product.findFirst({
        where: { barcode: raw.barcode },
      });

      if (existing) {
        console.log(`⏭️ Skipping existing product: ${raw.barcode}`);
        skipped++;
        continue;
      }

      // Map gender and age to enums
      let genderEnum: Gender | undefined;
      if (raw.gender) {
        const normalizedGender = raw.gender.toUpperCase() as Gender;
        if (Object.values(Gender).includes(normalizedGender)) {
          genderEnum = normalizedGender;
        } else {
          console.warn(`⚠️ Invalid gender value "${raw.gender}" for product ${raw.barcode}. Skipping.`);
        }
      }

      let ageGroupEnum: AgeGroup | undefined;
      if (raw.age) {
        const normalizedAge = raw.age.toUpperCase() as AgeGroup;
        if (Object.values(AgeGroup).includes(normalizedAge)) {
          ageGroupEnum = normalizedAge;
        } else {
          console.warn(`⚠️ Invalid age value "${raw.age}" for product ${raw.barcode}. Skipping.`);
        }
      }

      const product: ProductData = {
        barcode: raw.barcode,
        name: raw.name,
        brandName: raw['brand name'], // Access using string literal
        gender: genderEnum,
        ageGroup: ageGroupEnum,
        description: raw.description || '',
        imageUrl: raw.image || '',
        colors: raw.color ? raw.color.split(',').map(c => c.trim()).filter(Boolean) : [],
      };

      // Insert into database
      console.log(`💾 Inserting product ${product.barcode} into database...`);
      
      const created = await prisma.product.create({
        data: {
          barcode: product.barcode,
          name: product.name,
          brandName: product.brandName,
          gender: product.gender,
          ageGroup: product.ageGroup,
          description: product.description,
          imageUrl: product.imageUrl,
          colors: product.colors,
          isActive: true,
        },
      });

      imported++;

    } catch (err: any) {
      // Handle unique constraint errors gracefully
      if (err?.code === 'P2002' && err?.meta?.target?.includes('barcode')) {
        console.log(`⏭️ Skipping duplicate product (race condition): ${raw.barcode}`);
        skipped++;
      } else {
        console.error(`❌ Error inserting product ${raw.barcode}:`, err);
        errors++;
      }
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
  const allowLocal = process.env.ALLOW_LOCAL_PRODUCT_IMPORT === 'true';
  const isProduction = process.env.NODE_ENV === 'production';

  // Safety check: Warn if running in production without explicit flag
  if (isProduction && !allowLocal) {
    console.log('⚠️  Running in PRODUCTION mode');
    console.log('   Make sure you have the correct DATABASE_URL and OPENAI_API_KEY set');
    console.log('   To suppress this warning, set ALLOW_LOCAL_PRODUCT_IMPORT=true\n');
  }

  if (!fileArg) {
    console.error('Usage: npx ts-node scripts/importProducts.ts --file=products.csv [--clear]');
    console.error('  --file=path/to/file.csv  : Path to CSV or JSON file');
    console.error('  --clear                  : Delete all existing products before importing');
    process.exit(1);
  }

  let filePath = fileArg.replace('--file=', '');

// If the path isn't absolute, resolve it relative to the script's directory
if (!path.isAbsolute(filePath)) {
  // This helps the function find the file whether it's running in /src or /dist
  filePath = path.resolve(__dirname, '..', filePath); 
}

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

