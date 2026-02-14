import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkImageUrls() {
  console.log('🔍 Checking imageUrl values in database...\n');

  // Check total products
  const total = await prisma.product.count({ where: { isActive: true } });
  console.log(`📦 Total active products: ${total}`);

  // Check products with non-empty imageUrl using raw SQL
  const withUrls = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) as count FROM "Product" WHERE "isActive" = true AND "imageUrl" IS NOT NULL AND "imageUrl" != '' AND LENGTH(TRIM("imageUrl")) > 0`
  );
  console.log(`✅ Products with non-empty imageUrl: ${withUrls[0].count}`);

  // Check products with empty imageUrl
  const withEmpty = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) as count FROM "Product" WHERE "isActive" = true AND ("imageUrl" IS NULL OR "imageUrl" = '' OR LENGTH(TRIM("imageUrl")) = 0)`
  );
  console.log(`❌ Products with empty/null imageUrl: ${withEmpty[0].count}`);

  // Sample products with URLs
  console.log('\n📋 Sample products WITH imageUrl:');
  const sampleWithUrls = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    imageUrl: string;
  }>>(
    `SELECT id, name, "imageUrl" FROM "Product" WHERE "isActive" = true AND "imageUrl" IS NOT NULL AND "imageUrl" != '' AND LENGTH(TRIM("imageUrl")) > 0 LIMIT 5`
  );
  sampleWithUrls.forEach((p, i) => {
    console.log(`\n  ${i + 1}. ${p.name}`);
    console.log(`     imageUrl: ${p.imageUrl.substring(0, 80)}...`);
  });

  // Sample products without URLs
  console.log('\n📋 Sample products WITHOUT imageUrl:');
  const sampleWithoutUrls = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    imageUrl: string | null;
  }>>(
    `SELECT id, name, "imageUrl" FROM "Product" WHERE "isActive" = true AND ("imageUrl" IS NULL OR "imageUrl" = '' OR LENGTH(TRIM("imageUrl")) = 0) LIMIT 5`
  );
  sampleWithoutUrls.forEach((p, i) => {
    console.log(`\n  ${i + 1}. ${p.name}`);
    console.log(`     imageUrl: ${p.imageUrl === null ? 'NULL' : `"${p.imageUrl}" (empty)`}`);
  });

  // Check what the query returns
  console.log('\n🔍 Testing query result column names:');
  const testQuery = await prisma.$queryRawUnsafe<Array<{
    id: string;
    name: string;
    imageUrl: string;
    [key: string]: any;
  }>>(
    `SELECT id, name, "imageUrl" FROM "Product" WHERE "isActive" = true LIMIT 1`
  );
  if (testQuery.length > 0) {
    const row = testQuery[0];
    console.log(`   Column keys: ${Object.keys(row).join(', ')}`);
    console.log(`   row.imageUrl: ${row.imageUrl}`);
    console.log(`   row['imageUrl']: ${row['imageUrl']}`);
    console.log(`   row.imageurl: ${(row as any).imageurl || 'undefined'}`);
  }
}

checkImageUrls()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

