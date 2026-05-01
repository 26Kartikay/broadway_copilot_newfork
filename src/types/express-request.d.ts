import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Classifier slug snapshot for ApiRequestLog (set before res.end; survives response finish). */
    apiLogIntent?: string | null;
    /** Plain-language inference snapshot for ApiRequestLog. */
    apiLogIntentV2?: string | null;
  }
}
