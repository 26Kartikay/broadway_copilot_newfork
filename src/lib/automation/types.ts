export interface BroadwayApiProduct {
  id: number;
  barcode: string;
  name: string;
  brand: string;
  category: string | undefined;
  description: string | undefined;
  imageUrl: string | undefined;
  image_url: string | undefined;
  productLink: string | undefined;
  product_link: string | undefined;
}

export interface BarcodeListItem {
  id: number;
  barcode: string;
  name: string;
  brand: string | undefined;
  category: string | undefined;
}

export interface BarcodeListResponse {
  items: BarcodeListItem[];
  total: number;
  page: number;
  pages: number;
  has_next?: boolean;
}

export interface ExtractedTags {
  legacyCategory: string | null;
  subCategory: string | null;
  productType: string | null;
  gender: string | null;
  ageGroup: string | null;
  colors: string[];
  occasions: string[];
  style: string | null;
  fit: string | null;
  allTags: string;
  /** Short retail description (legacy; prefer formattedDescription) */
  shortDescription: string | null;
  /**
   * Full retail block for search + embeddings. Must follow the template in tagExtractor (name/brand, category line, Description, Attributes).
   */
  formattedDescription: string | null;
}

export interface ProcessableProduct {
  id: string;
  barcode: string | null;
  name: string;
  brand: string;
  category: string;
  embeddingStatus: string;
}

export interface ProductProcessResult {
  productId: string;
  barcode: string;
  success: boolean;
  durationMs: number;
  error?: string;
  tags?: ExtractedTags;
  embedding?: number[];
  searchDoc?: string;
}

export interface BatchItem {
  productId: string;
  barcode: string;
  tags: ExtractedTags;
  embedding: number[];
  searchDoc: string;
}

export interface AutomationMetrics {
  totalTasks: number;
  successCount: number;
  failureCount: number;
  averageDuration: number;
  errors: string[];
  startTime: Date;
  endTime?: Date;
}

export interface BarcodeSyncResult {
  totalFetched: number;
  newBarcodes: number;
  updatedBarcodes: number;
  linkedProducts: number;
  errors: number;
  durationMs: number;
}
