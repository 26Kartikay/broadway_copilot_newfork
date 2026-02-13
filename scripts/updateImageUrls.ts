import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

const prisma = new PrismaClient();

interface CSVProduct {
  barcode: string;
  name: string;
  imageUrl: string;
  [key: string]: any;
}

async function updateImageUrls() {
  console.log('🔄 Updating product imageUrls from CSV...\n');

  // Read CSV file
  const csvPath = path.join(__dirname, '../functions/src/data/products.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');

  const result = Papa.parse<CSVProduct>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const csvProducts = result.data;
  console.log(`📋 Found ${csvProducts.length} products in CSV\n`);

  let updated = 0;
  let notFound = 0;
  let empty = 0;

  // Create a map of barcode -> imageUrl for quick lookup
  const imageUrlMap = new Map<string, string>();
  for (const product of csvProducts) {
    const imageUrl = product.imageUrl || (product as any)['imageUrl'] || '';
    if (imageUrl && imageUrl.trim().length > 0) {
      imageUrlMap.set(product.barcode, imageUrl.trim());
    }
  }

  console.log(`📊 Found ${imageUrlMap.size} products with imageUrls in CSV\n`);

  // Update products in batches
  const allProducts = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, barcode: true, name: true, imageUrl: true },
  });

  console.log(`📦 Found ${allProducts.length} products in database\n`);

  for (const product of allProducts) {
    if (!product.barcode) {
      continue;
    }

    const csvImageUrl = imageUrlMap.get(product.barcode);
    
    if (!csvImageUrl) {
      notFound++;
      if (notFound <= 5) {
        console.log(`⚠️  No imageUrl found in CSV for: ${product.name} (${product.barcode})`);
      }
      continue;
    }

    if (csvImageUrl.trim().length === 0) {
      empty++;
      continue;
    }

    // Update if imageUrl is empty or different
    if (!product.imageUrl || product.imageUrl.trim().length === 0 || product.imageUrl !== csvImageUrl) {
      await prisma.product.update({
        where: { id: product.id },
        data: { imageUrl: csvImageUrl },
      });
      updated++;
      
      if (updated <= 5) {
        console.log(`✅ Updated: ${product.name}`);
        console.log(`   Old: "${product.imageUrl || '(empty)'}"`);
        console.log(`   New: "${csvImageUrl.substring(0, 60)}..."`);
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ⚠️  Not found in CSV: ${notFound}`);
  console.log(`   ❌ Empty in CSV: ${empty}`);
  console.log(`   📦 Total products: ${allProducts.length}`);
}

updateImageUrls()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

