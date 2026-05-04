import { prisma } from './prisma';

export interface PurgeDbLogsResult {
  /** Rows removed from ServiceLog */
  serviceLogDeleted: number;
  /** Rows removed from ApiRequestLog */
  apiRequestLogDeleted: number;
  /** Cutoff time (rows with createdAt older than this were deleted) */
  cutoff: Date;
}

/**
 * Deletes dashboard / persisted API rows older than the given number of full days.
 * Keeps the last N days of data (e.g. 7 means anything strictly before "now - 7d" is removed).
 */
export async function purgeDbLogsOlderThanDays(days: number): Promise<PurgeDbLogsResult> {
  const d = Math.floor(days);
  if (d < 1 || d > 365) {
    throw new Error('log retention days must be between 1 and 365');
  }
  const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);

  const [s, a] = await prisma.$transaction([
    prisma.serviceLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.apiRequestLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  return {
    serviceLogDeleted: s.count,
    apiRequestLogDeleted: a.count,
    cutoff,
  };
}
