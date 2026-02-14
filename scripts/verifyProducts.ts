/**
 * Product Verification Script
 * 
 * Verifies product data in the database including:
 * - Total product count
 * - Products with embeddings
 * - Products by gender
 * - Products by ageGroup
 * - Sample products
 * 
 * Usage:
 *   npx ts-node scripts/verifyProducts.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyProducts() {
  try {
    console.log('🔍 Verifying product data in database...\n');

    // 1. Total products
    const totalProducts = await prisma.product.count();
    console.log(`📦 Total Products: ${totalProducts}`);

    // 2. Active products
    const activeProducts = await prisma.product.count({
      where: { isActive: true },
    });
    console.log(`✅ Active Products: ${activeProducts}`);

    // 3. Products with embeddings
    const productsWithEmbeddings = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) as count FROM "Product" WHERE "embedding" IS NOT NULL AND "isActive" = true'
    );
    const embeddingCount = Number(productsWithEmbeddings[0].count);
    console.log(`🧠 Products with Embeddings: ${embeddingCount}`);

    // 4. Products by gender
    console.log('\n👥 Products by Gender:');
    const genderStats = await prisma.$queryRawUnsafe<Array<{ gender: string | null; count: bigint }>>(
      `SELECT gender, COUNT(*) as count 
       FROM "Product" 
       WHERE "isActive" = true 
       GROUP BY gender 
       ORDER BY count DESC`
    );
    genderStats.forEach((stat) => {
      const genderLabel = stat.gender || 'NULL/UNISEX';
      console.log(`   ${genderLabel}: ${Number(stat.count)}`);
    });

    // 5. Products by ageGroup
    console.log('\n🎂 Products by Age Group:');
    const ageGroupStats = await prisma.$queryRawUnsafe<Array<{ ageGroup: string | null; count: bigint }>>(
      `SELECT "ageGroup", COUNT(*) as count 
       FROM "Product" 
       WHERE "isActive" = true 
       GROUP BY "ageGroup" 
       ORDER BY count DESC`
    );
    ageGroupStats.forEach((stat) => {
      const ageLabel = stat.ageGroup || 'NULL';
      console.log(`   ${ageLabel}: ${Number(stat.count)}`);
    });

    // 6. Products by gender AND ageGroup combination
    console.log('\n🔗 Products by Gender + AgeGroup:');
    const comboStats = await prisma.$queryRawUnsafe<Array<{ gender: string | null; ageGroup: string | null; count: bigint }>>(
      `SELECT gender, "ageGroup", COUNT(*) as count 
       FROM "Product" 
       WHERE "isActive" = true 
       GROUP BY gender, "ageGroup" 
       ORDER BY count DESC 
       LIMIT 10`
    );
    comboStats.forEach((stat) => {
      const genderLabel = stat.gender || 'NULL';
      const ageLabel = stat.ageGroup || 'NULL';
      console.log(`   ${genderLabel} + ${ageLabel}: ${Number(stat.count)}`);
    });

    // 7. Sample products
    console.log('\n📋 Sample Products (first 10):');
    const sampleProducts = await prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        brandName: true,
        gender: true,
        ageGroup: true,
        category: true,
        colors: true,
        // embedding is Unsupported type, can't select it
      },
      take: 10,
    });

    sampleProducts.forEach((product, index) => {
      console.log(`\n   ${index + 1}. ${product.name}`);
      console.log(`      Brand: ${product.brandName}`);
      console.log(`      Gender: ${product.gender || 'NULL'}`);
      console.log(`      AgeGroup: ${product.ageGroup || 'NULL'}`);
      console.log(`      Category: ${product.category || 'NULL'}`);
      console.log(`      Colors: ${product.colors.join(', ') || 'N/A'}`);
    });

    // 8. Check for specific color searches
    console.log('\n🎨 Products matching color queries:');
    const colorQueries = ['rust', 'terracotta', 'burnt orange', 'orange'];
    
    for (const colorQuery of colorQueries) {
      const matchingProducts = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count 
         FROM "Product" 
         WHERE "isActive" = true 
         AND (
           LOWER(name) LIKE $1
           OR LOWER(description) LIKE $1
           OR EXISTS (SELECT 1 FROM unnest(colors) AS color WHERE LOWER(color) LIKE $1)
         )`,
        `%${colorQuery}%`
      );
      const count = Number(matchingProducts[0].count);
      console.log(`   "${colorQuery}": ${count} products`);
    }

    // 9. Products with embeddings by gender
    console.log('\n🧠 Products with Embeddings by Gender:');
    const embeddingByGender = await prisma.$queryRawUnsafe<Array<{ gender: string | null; count: bigint }>>(
      `SELECT gender, COUNT(*) as count 
       FROM "Product" 
       WHERE "embedding" IS NOT NULL AND "isActive" = true 
       GROUP BY gender 
       ORDER BY count DESC`
    );
    embeddingByGender.forEach((stat) => {
      const genderLabel = stat.gender || 'NULL/UNISEX';
      console.log(`   ${genderLabel}: ${Number(stat.count)}`);
    });

    // 10. Check for MALE + ADULT products specifically
    console.log('\n🎯 MALE + ADULT Products:');
    const maleAdultCount = await prisma.product.count({
      where: {
        isActive: true,
        gender: 'MALE',
        ageGroup: 'ADULT',
      },
    });
    console.log(`   Total: ${maleAdultCount}`);

    const maleAdultWithEmbeddings = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count 
       FROM "Product" 
       WHERE "isActive" = true 
       AND gender = 'male' 
       AND "ageGroup" = 'adult' 
       AND "embedding" IS NOT NULL`
    );
    console.log(`   With Embeddings: ${Number(maleAdultWithEmbeddings[0].count)}`);

    // 11. Check for FEMALE + ADULT products
    console.log('\n🎯 FEMALE + ADULT Products:');
    const femaleAdultCount = await prisma.product.count({
      where: {
        isActive: true,
        gender: 'FEMALE',
        ageGroup: 'ADULT',
      },
    });
    console.log(`   Total: ${femaleAdultCount}`);

    const femaleAdultWithEmbeddings = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count 
       FROM "Product" 
       WHERE "isActive" = true 
       AND gender = 'female' 
       AND "ageGroup" = 'adult' 
       AND "embedding" IS NOT NULL`
    );
    console.log(`   With Embeddings: ${Number(femaleAdultWithEmbeddings[0].count)}`);

    console.log('\n✅ Verification complete!');
  } catch (err) {
    console.error('❌ Error verifying products:', err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

verifyProducts();

