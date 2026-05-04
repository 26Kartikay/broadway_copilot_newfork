import { createId } from '@paralleldrive/cuid2';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import type { SeedRowProductInput } from './bulkCatalogMapping';

const BATCH = 250;

function toUpdateData(
  input: SeedRowProductInput,
  setEmbeddingPending: boolean,
  markTagged: boolean,
): Prisma.ProductUpdateInput {
  const base: Prisma.ProductUpdateInput = {
    name: input.name,
    brand: input.brand,
    category: input.category,
    generalTag: input.generalTag,
    imageUrl: input.imageUrl,
    productLink: input.productLink,
    searchDoc: input.searchDoc,
    componentTags: input.componentTags as Prisma.InputJsonValue,
    legacyCategory: input.legacyCategory,
    subCategory: input.subCategory,
    productType: input.productType,
    allTags: input.allTags,
    colors: input.colors,
    occasions: input.occasions,
    style: input.style,
    fit: input.fit,
    isActive: true,
  };
  if (markTagged) {
    base.taggedBy = 'csv-bulk';
    base.taggedAt = new Date();
  }
  if (setEmbeddingPending) {
    base.embeddingStatus = 'pending';
    base.automationErrors = { set: [] };
  }
  return base;
}

function toCreateData(
  input: SeedRowProductInput,
  handleId: string,
  markTagged: boolean,
): Prisma.ProductCreateInput {
  const base: Prisma.ProductCreateInput = {
    handleId,
    barcode: input.barcode,
    name: input.name,
    brand: input.brand,
    category: input.category,
    generalTag: input.generalTag,
    imageUrl: input.imageUrl,
    productLink: input.productLink,
    searchDoc: input.searchDoc,
    componentTags: input.componentTags as Prisma.InputJsonValue,
    legacyCategory: input.legacyCategory,
    subCategory: input.subCategory,
    productType: input.productType,
    allTags: input.allTags,
    colors: input.colors,
    occasions: input.occasions,
    style: input.style,
    fit: input.fit,
    isActive: true,
    embeddingStatus: 'pending',
    automationErrors: [],
  };
  if (markTagged) {
    base.taggedBy = 'csv-bulk';
    base.taggedAt = new Date();
  }
  return base;
}

export async function bulkUpsertProducts(
  rows: SeedRowProductInput[],
  options: { resetEmbeddingQueue: boolean; markTagged: boolean },
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const barcodes = chunk.map((r) => r.barcode);
    const existing = await prisma.product.findMany({
      where: { barcode: { in: barcodes } },
      select: { id: true, barcode: true },
    });
    const byBarcode = new Map(existing.map((e) => [e.barcode ?? '', e.id]));

    for (const input of chunk) {
      const id = byBarcode.get(input.barcode);
      if (id) {
        await prisma.product.update({
          where: { id },
          data: toUpdateData(input, options.resetEmbeddingQueue, options.markTagged),
        });
        updated++;
      } else {
        const handleId = `bulk-${input.barcode.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${createId().slice(0, 10)}`.slice(
          0,
          120,
        );
        await prisma.product.create({
          data: toCreateData(input, handleId, options.markTagged),
        });
        created++;
      }
    }
  }

  return { created, updated };
}

/** Tag-only pass: same row shape; updates taxonomy columns + taggedBy (expects barcode present). */
export async function bulkApplyTags(rows: SeedRowProductInput[]): Promise<{ updated: number }> {
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    for (const input of chunk) {
      const r = await prisma.product.updateMany({
        where: { barcode: input.barcode },
        data: {
          componentTags: input.componentTags as Prisma.InputJsonValue,
          legacyCategory: input.legacyCategory,
          subCategory: input.subCategory,
          productType: input.productType,
          allTags: input.allTags,
          colors: input.colors,
          occasions: input.occasions,
          style: input.style,
          fit: input.fit,
          searchDoc: input.searchDoc,
          taggedBy: 'csv-bulk',
          taggedAt: new Date(),
          embeddingStatus: 'pending',
          automationErrors: { set: [] },
        },
      });
      updated += r.count;
    }
  }
  return { updated };
}
