import { lookupBrands, type BrandHighlight, type LookupBrandsInput } from '../../data/brandsCatalog';

export interface LookupBrandsToolInput {
  query?: string;
  highlight?: BrandHighlight;
  limit?: number;
}

export function runLookupBrandsTool(input: LookupBrandsToolInput) {
  const payload: LookupBrandsInput = {};
  if (input.query !== undefined) payload.query = input.query;
  if (input.highlight !== undefined) payload.highlight = input.highlight;
  if (input.limit !== undefined) payload.limit = input.limit;
  return lookupBrands(payload);
}
