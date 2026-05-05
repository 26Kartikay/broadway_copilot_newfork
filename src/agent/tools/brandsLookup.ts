import { lookupBrands, type LookupBrandsInput } from '../../data/brandsCatalog';

export interface LookupBrandsToolInput {
  query?: string;
  category?: string;
  limit?: number;
}

export function runLookupBrandsTool(input: LookupBrandsToolInput) {
  const payload: LookupBrandsInput = {};
  if (input.query !== undefined) payload.query = input.query;
  if (input.category !== undefined) payload.category = input.category;
  if (input.limit !== undefined) payload.limit = input.limit;
  return lookupBrands(payload);
}
