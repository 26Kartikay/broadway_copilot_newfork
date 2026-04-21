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
import { createId } from '@paralleldrive/cuid2';
import Papa from 'papaparse';
import { PrismaClient, Gender, AgeGroup, ProductCategory } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
// Removed OpenAI import as embeddings are no longer generated

const prisma = new PrismaClient();
// Removed openai client initialization

// Removed BATCH_SIZE, EMBEDDING_MODEL, EMBEDDING_DIM as they are no longer needed.

function mapCategory(raw?: string | null): ProductCategory {
  if (!raw?.trim()) return ProductCategory.CLOTHING_FASHION;
  const compact = raw.trim().toUpperCase().replace(/\s*&\s*/g, '_').replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_');
  if ((Object.values(ProductCategory) as string[]).includes(compact)) {
    return compact as ProductCategory;
  }
  const lower = raw.toLowerCase();
  if (lower.includes('footwear') || lower.includes('shoe') || lower.includes('sneaker')) {
    return ProductCategory.FOOTWEAR;
  }
  if (lower.includes('bag') || lower.includes('luggage')) {
    return ProductCategory.BAGS_LUGGAGE;
  }
  if (lower.includes('jewel') || lower.includes('accessor')) {
    return ProductCategory.JEWELLERY_ACCESSORIES;
  }
  if (lower.includes('beauty') || lower.includes('skincare') || lower.includes('makeup') || lower.includes('grooming')) {
    return ProductCategory.BEAUTY_PERSONAL_CARE;
  }
  if (lower.includes('health') || lower.includes('wellness') || lower.includes('supplement')) {
    return ProductCategory.HEALTH_WELLNESS;
  }
  return ProductCategory.CLOTHING_FASHION;
}

function slugHandleId(base: string): string {
  const s = base
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return s || createId();
}

function buildImportSearchDoc(p: ProductData): string {
  const parts: string[] = [];
  if (p.name) parts.push(p.name);
  if (p.brandName) parts.push(`Brand: ${p.brandName}`);
  if (p.category) parts.push(`Category: ${p.category}`);
  if (p.subCategory) parts.push(`Subcategory: ${p.subCategory}`);
  if (p.productType) parts.push(`Type: ${p.productType}`);
  parts.push(`Gender: ${p.gender}`);
  if (p.ageGroup) parts.push(`Age Group: ${p.ageGroup}`);
  if (p.colorPalette) parts.push(`Palette: ${p.colorPalette}`);
  if (p.colors.length) parts.push(`Colors: ${p.colors.join(', ')}`);
  if (p.allTags) parts.push(`Tags: ${p.allTags}`);
  return parts.join('. ') || `Product ${p.gender}`;
}

// ============================================================================
// PRODUCT DATA INTERFACES
// ============================================================================

interface ProductData {
  barcode: string;
  name?: string;
  brandName?: string;
  gender: Gender;
  ageGroup?: AgeGroup;
  category?: string;
  subCategory?: string;
  productType?: string;
  colorPalette?: string;
  imageUrl: string;
  colors: string[];
  allTags?: string;
}

// Removed buildSearchDoc function as searchDoc is no longer in Product model.

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

interface RawProduct {
  barcode: string;
  name?: string;
  brandName?: string; // Use camelCase to match CSV header
  gender?: string;
  age?: string;
  ageGroup?: string; // CSV has ageGroup column
  category?: string;
  subCategory?: string;
  productType?: string;
  colorPalette?: string;
  imageUrl: string;
  productLink?: string;
  color?: string; // This will be a comma-separated string
  colors?: string; // Alternative column name
  allTags?: string; // Comma-separated tags
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
    const result = Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    rawProducts = result.data as RawProduct[];
    if (result.errors.length > 0) {
      console.warn('⚠️  Errors encountered during CSV parsing:');
      console.warn(result.errors);
    }
  }

  console.log(`📋 Found ${rawProducts.length} products to import`);

  // Debug: Show column names from first row
  if (rawProducts.length > 0) {
    console.log(`\n📊 CSV Columns detected: ${Object.keys(rawProducts[0]).join(', ')}`);
    console.log(`📊 Sample first product keys: ${Object.keys(rawProducts[0]).join(', ')}`);
    if (rawProducts[0].barcode !== undefined) {
      console.log(`✅ 'barcode' column found. Sample value: "${rawProducts[0].barcode}"`);
    } else {
      console.log(`⚠️ 'barcode' column NOT found. Available columns: ${Object.keys(rawProducts[0]).join(', ')}`);
    }
  }

  // Process in batches
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < rawProducts.length; i++) { // Process one by one since no embeddings batching
    const raw = rawProducts[i];
    const productNum = i + 1;
    const totalProducts = rawProducts.length;

    console.log(`\n🔄 Processing product ${productNum}/${totalProducts}: ${raw.name || raw.barcode || 'unknown'}`);

    // Try multiple possible column names for barcode
    const barcodeValue = raw.barcode || 
                        (raw as any)['barcode'] || 
                        (raw as any)['Barcode'] || 
                        (raw as any)['BARCODE'] ||
                        (raw as any)['barcode_number'] ||
                        (raw as any)['sku'] ||
                        (raw as any)['SKU'] ||
                        '';
    
    // Ensure barcode is a string (handle scientific notation and leading quotes)
    let barcodeStr = String(barcodeValue || '').trim();
    if (barcodeStr.startsWith("'")) {
      barcodeStr = barcodeStr.substring(1);
    }
    if (barcodeStr.includes('E+') || barcodeStr.includes('e+')) {
      const num = parseFloat(barcodeStr);
      if (!isNaN(num)) {
        barcodeStr = num.toFixed(0); // Convert to integer string without scientific notation
      }
    }

    try {
      if (barcodeStr.startsWith("'")) {
        barcodeStr = barcodeStr.substring(1);
      }
      if (barcodeStr.includes('E+') || barcodeStr.includes('e+')) {
        const num = parseFloat(barcodeStr);
        if (!isNaN(num)) {
          barcodeStr = num.toFixed(0);
        }
      }
      
      // Check for duplicates (within the entire set, as we're processing one by one)
      if (!barcodeStr || barcodeStr.trim() === '') {
        console.log(`⚠️ Skipping product with empty barcode: ${raw.name || 'unknown'}`);
        skipped++;
        continue;
      }

      const existing = await prisma.product.findFirst({
        where: { barcode: barcodeStr },
      });

      if (existing) {
        console.log(`⏭️ Skipping existing product (barcode: ${barcodeStr}, name: ${raw.name || 'unknown'})`);
        skipped++;
        continue;
      }

      // Map gender and age to enums
      // Handle various input formats: "female", "FEMALE", "women", "male", "MALE", "men", etc.
      // Gender is now required, so we must have a value
      let genderEnum: Gender;
      const genderValue = raw.gender || (raw as any)['gender'] || '';
      if (genderValue) {
        const genderLower = String(genderValue).toLowerCase().trim();
        const genderUpper = String(genderValue).trim().toUpperCase();
        // Map common variations to Prisma enum values
        if (
          genderLower === 'female' ||
          genderLower === 'women' ||
          genderLower === 'woman' ||
          genderLower === 'f' ||
          genderLower === 'fem' ||
          genderUpper === 'FEMALE'
        ) {
          genderEnum = Gender.FEMALE;
        } else if (
          genderLower === 'male' ||
          genderLower === 'men' ||
          genderLower === 'man' ||
          genderLower === 'm' ||
          genderUpper === 'MALE'
        ) {
          genderEnum = Gender.MALE;
        } else if (
          genderLower === 'other' ||
          genderLower === 'unisex' ||
          genderLower === 'both' ||
          genderLower === 'all' ||
          genderLower === 'any' ||
          genderUpper === 'OTHER'
        ) {
          genderEnum = Gender.OTHER;
        } else {
          console.warn(`⚠️ Invalid gender value "${genderValue}" for product ${barcodeStr}. Defaulting to OTHER.`);
          genderEnum = Gender.OTHER; // Default to OTHER if invalid
        }
      } else {
        console.warn(`⚠️ Missing gender for product ${barcodeStr}. Defaulting to OTHER.`);
        genderEnum = Gender.OTHER; // Default to OTHER if missing
      }

      let ageGroupEnum: AgeGroup | undefined;
      const ageValue = raw.ageGroup || raw.age || (raw as any)['ageGroup'] || (raw as any)['age']; // Support both column names and case variations
      if (ageValue) {
        const ageRaw = String(ageValue).trim();
        const ageStr = ageRaw.toLowerCase();
        const ageUpper = ageRaw.toUpperCase();
        // Skip empty values and common "not applicable" indicators
        if (ageStr === '' || ageStr === 'n/a' || ageStr === 'na' || ageStr === 'null' || ageStr === 'none' || ageStr === 'undefined') {
          ageGroupEnum = undefined;
        } else if (ageStr === 'teen' || ageStr === 'teens' || ageStr === 'teenager' || ageStr === 't' || ageUpper === 'TEEN') {
          ageGroupEnum = AgeGroup.TEEN;
        } else if (ageStr === 'adult' || ageStr === 'adults' || ageStr === 'a' || ageUpper === 'ADULT') {
          ageGroupEnum = AgeGroup.ADULT;
        } else if (ageStr === 'senior' || ageStr === 'seniors' || ageStr === 'elderly' || ageStr === 's' || ageUpper === 'SENIOR') {
          ageGroupEnum = AgeGroup.SENIOR;
        } else {
          // If it's not a recognized value, log a warning and skip it
          console.warn(`⚠️ Invalid ageGroup value "${ageValue}" for product ${barcodeStr}. Skipping ageGroup.`);
          ageGroupEnum = undefined;
        }
      }

      // Debug: Check what imageUrl value we're getting from CSV
      if (imported < 3 || (i < 20 && imported < 20)) {
        console.log(`\n🔍 Debug product ${i + 1}:`);
        console.log(`   Raw keys: ${Object.keys(raw).join(', ')}`);
        console.log(`   raw.gender: "${raw.gender}" (type: ${typeof raw.gender})`);
        console.log(`   Mapped to: ${genderEnum}`);
        console.log(`   raw.ageGroup: "${raw.ageGroup}" (type: ${typeof raw.ageGroup})`);
        console.log(`   raw.age: "${raw.age}" (type: ${typeof raw.age})`);
        console.log(`   Mapped ageGroup to: ${ageGroupEnum || 'null'}`);
      }
      
      // Access imageUrl - try multiple ways in case of column name issues
      const imageUrlValue = raw.imageUrl || 
                           (raw as any)['imageUrl'] || 
                           (raw as any).image || 
                           (raw as any)['image'] ||
                           '';
      
      // Validate enum values before creating product object
      if (!Object.values(Gender).includes(genderEnum)) {
        console.error(`❌ Invalid gender enum value: ${genderEnum} for product ${barcodeStr}`);
        errors++;
        continue;
      }
      
      if (ageGroupEnum && !Object.values(AgeGroup).includes(ageGroupEnum)) {
        console.warn(`⚠️ Invalid ageGroup enum value: ${ageGroupEnum} for product ${barcodeStr}. Setting to null.`);
        ageGroupEnum = undefined;
      }

      const product: ProductData = {
        barcode: barcodeStr, // Already defined above
        name: raw.name || undefined,
        brandName: raw.brandName || undefined,
        gender: genderEnum, // Required field
        ageGroup: ageGroupEnum,
        category: raw.category || undefined,
        subCategory: raw.subCategory || undefined,
        productType: raw.productType || undefined,
        colorPalette: raw.colorPalette || undefined,
        imageUrl: imageUrlValue, // Required field
        colors: (raw.colors || raw.color) ? String(raw.colors || raw.color).split(',').map(c => c.trim()).filter(Boolean) : [],
        allTags: raw.allTags || undefined,
      };

      console.log(`💾 Inserting product ${product.barcode} into database...`);

      let handleId = slugHandleId(barcodeStr);
      let handleSuffix = 0;
      while (await prisma.product.findUnique({ where: { handleId } })) {
        handleSuffix += 1;
        handleId = `${slugHandleId(barcodeStr)}-${handleSuffix}`;
      }

      const productLink =
        (raw.productLink && String(raw.productLink).trim()) ||
        (imageUrlValue && String(imageUrlValue).trim()) ||
        'https://broadwaylive.in';

      try {
        await prisma.product.create({
          data: {
            id: createId(),
            handleId,
            barcode: product.barcode,
            name: product.name || 'Unknown',
            brand: product.brandName || 'Unknown',
            category: mapCategory(product.category),
            generalTag: product.productType || 'general',
            colors: product.colors,
            componentTags: {
              gender: product.gender,
              ageGroup: product.ageGroup ?? null,
              legacyCategory: product.category ?? null,
              subCategory: product.subCategory ?? null,
              colorPalette: product.colorPalette ?? null,
              allTags: product.allTags ?? null,
            },
            imageUrl: product.imageUrl,
            productLink,
            searchDoc: buildImportSearchDoc(product),
            isActive: true,
          },
        });
        imported++;
      } catch (createError: any) {
        console.error(`❌ Error inserting product ${barcodeStr}:`, createError?.message);
        console.error(`   Error code: ${createError?.code}`);
        console.error(`   ImageUrl: "${product.imageUrl}"`);
        throw createError;
      }

    } catch (err: any) {
      // barcodeStr already defined at the start of the try block
      // Handle unique constraint errors gracefully
      if (err?.code === 'P2002' && err?.meta?.target?.includes('barcode')) {
        console.log(`⏭️ Skipping duplicate product (race condition): ${barcodeStr}`);
        skipped++;
      } else {
        console.error(`❌ Error inserting product ${barcodeStr}:`, err);
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

