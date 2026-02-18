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
 *   - barcode: Product barcode/SKU (required)
 *   - gender: Gender (MALE, FEMALE, OTHER) - required
 *   - ageGroup: Age group (TEEN, ADULT, SENIOR) - required
 *   - imageUrl: Product image URL (required)
 * 
 * Optional CSV columns:
 *   - name: Product name
 *   - brandName: Brand name
 *   - category: Product category
 *   - subCategory: Product subcategory
 *   - productType: Product type
 *   - colorPalette: Color palette
 *   - color/colors: Comma-separated list of colors
 *   - allTags: All tags as comma-separated string
 */

import 'dotenv/config';
import Papa from 'papaparse';
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
        // Map common variations to Prisma enum values
        if (genderLower === 'female' || genderLower === 'women' || genderLower === 'woman' || genderLower === 'f' || genderLower === 'fem') {
          genderEnum = Gender.FEMALE;
        } else if (genderLower === 'male' || genderLower === 'men' || genderLower === 'man' || genderLower === 'm') {
          genderEnum = Gender.MALE;
        } else if (genderLower === 'other' || genderLower === 'unisex' || genderLower === 'both' || genderLower === 'all' || genderLower === 'any') {
          genderEnum = Gender.OTHER;
        } else {
          console.warn(`⚠️ Invalid gender value "${genderValue}" for product ${barcodeStr}. Defaulting to OTHER.`);
          genderEnum = Gender.OTHER; // Default to OTHER if invalid
        }
      } else {
        console.warn(`⚠️ Missing gender for product ${barcodeStr}. Defaulting to OTHER.`);
        genderEnum = Gender.OTHER; // Default to OTHER if missing
      }
      
      // Gender is required - skip product if missing
      if (!genderEnum) {
        console.warn(`⚠️ Missing required gender for product ${barcodeStr}. Skipping product.`);
        skipped++;
        continue;
      }

      let ageGroupEnum: AgeGroup | undefined;
      const ageValue = raw.ageGroup || raw.age || (raw as any)['ageGroup'] || (raw as any)['age']; // Support both column names and case variations
      if (ageValue) {
        const ageStr = String(ageValue).toLowerCase().trim();
        // Skip empty values and common "not applicable" indicators
        if (ageStr === '' || ageStr === 'n/a' || ageStr === 'na' || ageStr === 'null' || ageStr === 'none' || ageStr === 'undefined') {
          ageGroupEnum = undefined;
        } else if (ageStr === 'teen' || ageStr === 'teens' || ageStr === 'teenager' || ageStr === 't') {
          ageGroupEnum = AgeGroup.TEEN;
        } else if (ageStr === 'adult' || ageStr === 'adults' || ageStr === 'a') {
          ageGroupEnum = AgeGroup.ADULT;
        } else if (ageStr === 'senior' || ageStr === 'seniors' || ageStr === 'elderly' || ageStr === 's') {
          ageGroupEnum = AgeGroup.SENIOR;
        } else {
          // If it's not a recognized value, log a warning and skip it
          console.warn(`⚠️ Invalid ageGroup value "${ageValue}" for product ${barcodeStr}. Skipping ageGroup.`);
          ageGroupEnum = undefined;
        }
      }
      
      // AgeGroup is required - skip product if missing
      if (!ageGroupEnum) {
        console.warn(`⚠️ Missing required ageGroup for product ${barcodeStr}. Skipping product.`);
        skipped++;
        continue;
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
      
      // Validate required fields
      if (!imageUrlValue || imageUrlValue.trim() === '') {
        console.warn(`⚠️ Missing required imageUrl for product ${barcodeStr}. Skipping product.`);
        skipped++;
        continue;
      }

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

      // Insert into database
      console.log(`💾 Inserting product ${product.barcode} into database...`);
      
      // Convert Prisma enum to database value (lowercase due to @map directive)
      // Gender.MALE -> "male", Gender.FEMALE -> "female", Gender.OTHER -> "other"
      const genderDbValue = product.gender === Gender.MALE ? 'male' : 
                           product.gender === Gender.FEMALE ? 'female' : 'other';
      
      // AgeGroup enum values: TEEN -> "teen", ADULT -> "adult", SENIOR -> "senior"
      const ageGroupDbValue = product.ageGroup === AgeGroup.TEEN ? 'teen' :
                             product.ageGroup === AgeGroup.ADULT ? 'adult' :
                             product.ageGroup === AgeGroup.SENIOR ? 'senior' : null;
      
      try {
        // Use raw SQL to bypass Prisma enum validation issues with duplicate enum values
        // This ensures we insert the correct lowercase values directly, working in both local and production
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Product" (
            "barcode", "name", "brandName", "gender", "ageGroup",
            "category", "subCategory", "productType", "colorPalette",
            "imageUrl", "colors", "allTags", "createdAt", "updatedAt"
          ) VALUES (
            $1::text,
            $2::text,
            $3::text,
            $4::"Gender",
            $5::"AgeGroup",
            $6::text,
            $7::text,
            $8::text,
            $9::text,
            $10::text,
            $11::text[],
            $12::text,
            NOW(),
            NOW()
          )
        `, 
          product.barcode,
          product.name || null,
          product.brandName || null,
          genderDbValue,  // Always lowercase: 'male', 'female', or 'other'
          ageGroupDbValue, // Always lowercase: 'teen', 'adult', 'senior', or null
          product.category || null,
          product.subCategory || null,
          product.productType || null,
          product.colorPalette || null,
          product.imageUrl,
          product.colors,
          product.allTags || null
        );
        imported++;
      } catch (createError: any) {
        // If error occurs, log details and re-throw (raw SQL should work, so this is unexpected)
        console.error(`❌ Error inserting product ${barcodeStr}:`, createError?.message);
        console.error(`   Error code: ${createError?.code}`);
        console.error(`   Gender DB value: "${genderDbValue}"`);
        console.error(`   AgeGroup DB value: "${ageGroupDbValue || 'null'}"`);
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

