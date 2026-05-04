import 'dotenv/config';
import { prisma } from '../../lib/prisma';
import { extractTagsFromProduct } from '../../lib/automation/tagExtractor';
import type { BroadwayApiProduct } from '../../lib/automation/types';

interface TestCase {
  product: Partial<BroadwayApiProduct> & { barcode: string; name: string; brand: string };
  expectedTags: string[];
  shouldNotContain?: string[];
  expectedCategory?: string;
  expectedSubCategory?: string;
}

const TEST_CASES: TestCase[] = [
  {
    product: { barcode: 'TEST001', name: 'Cotton Kurta with Palazzo', brand: 'Biba', description: 'Ethnic wear for festive occasions' },
    expectedTags: ['Ethnic Wear', 'Festive'],
    shouldNotContain: ['Foundation', 'Mascara'],
    expectedCategory: 'CLOTHING_FASHION',
    expectedSubCategory: 'Ethnic Wear',
  },
  {
    product: { barcode: 'TEST002', name: 'Matte Liquid Foundation SPF 15', brand: 'Lakme', description: 'Full coverage matte foundation for oily skin' },
    expectedTags: ['Foundations', 'Matte'],
    shouldNotContain: ['Ethnic Wear', 'Hoodies'],
    expectedCategory: 'BEAUTY_PERSONAL_CARE',
    expectedSubCategory: 'Foundations',
  },
  {
    product: { barcode: 'TEST003', name: 'Oversized Graphic Hoodie', brand: 'H&M', description: 'Streetwear hoodie with print' },
    expectedTags: ['Hoodies'],
    shouldNotContain: ['Eyeliner', 'Foundation'],
    expectedCategory: 'CLOTHING_FASHION',
  },
  {
    product: { barcode: 'TEST004', name: 'Waterproof Kajal Eyeliner', brand: 'Maybelline', description: 'Long-lasting waterproof kajal' },
    expectedTags: ['Eyeliners', 'Waterproof'],
    expectedCategory: 'BEAUTY_PERSONAL_CARE',
    expectedSubCategory: 'Eyeliners',
  },
  {
    product: { barcode: 'TEST005', name: 'Running Shoes with Cushioning', brand: 'Nike', description: 'Sports shoes for gym and running' },
    expectedTags: ['Sneakers'],
    expectedCategory: 'FOOTWEAR',
  },
  {
    product: { barcode: 'TEST006', name: 'Gold Plated Jhumka Earrings', brand: 'Zaveri Pearls', description: 'Traditional gold jhumka for festive wear' },
    expectedTags: ['Earrings', 'Festive'],
    expectedCategory: 'JEWELLERY_ACCESSORIES',
  },
  {
    product: { barcode: 'TEST007', name: 'Vitamin C Brightening Serum', brand: 'Minimalist', description: 'Brightening serum with niacinamide, alcohol-free and paraben-free' },
    expectedTags: ['Serums', 'Brightening'],
    expectedCategory: 'BEAUTY_PERSONAL_CARE',
    expectedSubCategory: 'Serums',
  },
  {
    product: { barcode: 'TEST008', name: 'Slim Fit Formal Trousers', brand: 'Van Heusen', description: 'Slim fit formal trousers for office wear' },
    expectedTags: ['Trousers', 'Formal'],
    expectedCategory: 'CLOTHING_FASHION',
  },
  {
    product: { barcode: 'TEST009', name: 'Tote Bag with Zipper', brand: 'Lavie', description: 'Spacious tote bag for office and travel' },
    expectedTags: ['Tote Bags'],
    expectedCategory: 'BAGS_LUGGAGE',
  },
  {
    product: { barcode: 'TEST010', name: 'Matte Lip Colour', brand: 'Nykaa', description: 'Long-lasting matte lipstick in bold shades' },
    expectedTags: ['Lipsticks', 'Matte'],
    expectedCategory: 'BEAUTY_PERSONAL_CARE',
  },
];

async function runValidation() {
  console.log('=== AUTOMATION VALIDATION ===\n');
  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    const product: BroadwayApiProduct = {
      id: 0,
      barcode: tc.product.barcode,
      name: tc.product.name,
      brand: tc.product.brand,
      category: tc.product.category,
      description: tc.product.description,
      imageUrl: undefined,
      image_url: undefined,
      productLink: undefined,
      product_link: undefined,
    };

    process.stdout.write(`Testing "${product.name}"... `);

    try {
      const tags = await extractTagsFromProduct(product);
      const allTagsLower = tags.allTags.toLowerCase();
      const issues: string[] = [];

      for (const expected of tc.expectedTags) {
        if (!allTagsLower.includes(expected.toLowerCase())) {
          issues.push(`Missing tag: "${expected}"`);
        }
      }

      for (const excluded of tc.shouldNotContain ?? []) {
        if (allTagsLower.includes(excluded.toLowerCase())) {
          issues.push(`Should not contain: "${excluded}"`);
        }
      }

      if (tc.expectedCategory && tags.legacyCategory !== tc.expectedCategory) {
        issues.push(`Category mismatch: got "${tags.legacyCategory}", expected "${tc.expectedCategory}"`);
      }

      if (tc.expectedSubCategory && tags.subCategory !== tc.expectedSubCategory) {
        issues.push(`SubCategory mismatch: got "${tags.subCategory}", expected "${tc.expectedSubCategory}"`);
      }

      if (issues.length === 0) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log(`❌ FAIL`);
        for (const issue of issues) console.log(`   - ${issue}`);
        console.log(`   Tags extracted: ${tags.allTags}`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    // Avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== RESULTS: ${passed}/${TEST_CASES.length} passed ===`);
  if (failed > 0) {
    console.log(`${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log('All tests passed!');
    process.exit(0);
  }
}

runValidation()
  .finally(() => prisma.$disconnect())
  .catch(err => {
    console.error('Validation fatal error:', err);
    process.exit(1);
  });
