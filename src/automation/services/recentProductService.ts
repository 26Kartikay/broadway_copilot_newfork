import { PrismaClient, ProductCategory } from '@prisma/client';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { fetchRecentSkus } from '../../lib/automation/recentSkuFetcher';
import { broadwayApiConfig } from '../../lib/automation/config';
import { createId } from '@paralleldrive/cuid2';

/**
 * Maps raw category strings to ProductCategory enum.
 * Alignment with scripts/importProducts.ts
 */
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

/**
 * Syncs recent products from Broadway API into the local database.
 * Does NOT perform tagging/embedding; just populates the queue.
 */
export async function syncRecentProducts(): Promise<{
  totalFetched: number;
  newProducts: number;
  updatedProducts: number;
  errors: number;
}> {
  const lookback = broadwayApiConfig.recentSkusLookbackHours;
  let newProducts = 0;
  let updatedProducts = 0;
  let errors = 0;

  try {
    const items = await fetchRecentSkus(lookback);

    for (const item of items) {
      try {
        // Find existing by barcode
        const existing = await prisma.product.findFirst({
          where: { barcode: item.barcode },
        });

        if (existing) {
          // Update basic info but preserve tags/embeddings if they already exist
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              dbId: String(item.id), // Ensure SKU ID is synced for recco
              name: item.name,
              brand: item.brand,
              category: mapCategory(item.category),
              imageUrl: item.imageUrl,
              productLink: item.productLink || existing.productLink,
              isActive: true,
              updatedAt: new Date(),
            },
          });
          updatedProducts++;
        } else {
          // Create new product in 'pending' state
          let handleId = slugHandleId(item.barcode);
          
          // Collision check for handleId
          const collision = await prisma.product.findUnique({ where: { handleId } });
          if (collision) {
            handleId = `${handleId}-${createId().slice(0, 4)}`;
          }

          await prisma.product.create({
            data: {
              id: createId(),
              handleId,
              dbId: String(item.id),
              barcode: item.barcode,
              name: item.name,
              brand: item.brand,
              category: mapCategory(item.category),
              generalTag: 'recent_sync',
              imageUrl: item.imageUrl,
              productLink: item.productLink,
              searchDoc: `${item.name}. Brand: ${item.brand}. Category: ${item.category}`,
              componentTags: {},
              embeddingStatus: 'pending',
              isActive: true,
            },
          });
          newProducts++;
        }
      } catch (err) {
        errors++;
        logger.error({ err: err instanceof Error ? err.message : String(err), barcode: item.barcode }, '[RecentProductSync] Failed to upsert product');
      }
    }

    return { totalFetched: items.length, newProducts, updatedProducts, errors };
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[RecentProductSync] Sync failed');
    throw err;
  }
}
