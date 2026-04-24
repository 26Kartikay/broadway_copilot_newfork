import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Locals {
    /** Classifier intent slug (e.g. product_search). */
    intent?: string;
    /** Plain-text classifier inference; merged into request log on finish. */
    intentV2?: string;
    /** Prisma User.id for ApiRequestLog. */
    requestLogUserId?: string;
    /** Display name snapshot for ApiRequestLog. */
    requestLogUserName?: string;
    /** Error message when the handler failed (ApiRequestLog.error). */
    requestLogError?: string;
  }
}
