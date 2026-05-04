import { prisma } from '../../lib/prisma';

export interface RunSummary {
  id: string;
  name: string;
  status: string;
  totalTasks: number;
  successCount: number;
  failureCount: number;
  successRatePct: number;
  averageDurationMs: number;
  startTime: Date;
  endTime: Date | null;
  durationSeconds: number | null;
}

export async function getRecentRuns(name?: string, limit = 10): Promise<RunSummary[]> {
  const rows = await prisma.automationRun.findMany({
    ...(name ? { where: { name } } : {}),
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  type RunRow = typeof rows[number];
  return rows.map((r: RunRow) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    totalTasks: r.totalTasks,
    successCount: r.successCount,
    failureCount: r.failureCount,
    successRatePct:
      r.totalTasks > 0 ? Math.round((r.successCount / r.totalTasks) * 10000) / 100 : 0,
    averageDurationMs: r.averageDuration,
    startTime: r.startTime,
    endTime: r.endTime,
    durationSeconds:
      r.endTime ? Math.round((r.endTime.getTime() - r.startTime.getTime()) / 1000) : null,
  }));
}

export async function getEmbeddingStatusCounts(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ status: string; count: bigint }>>(
    `SELECT "embeddingStatus" as status, COUNT(*) as count FROM "Product" GROUP BY "embeddingStatus"`,
  );
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.status] = Number(row.count);
  }
  return result;
}

export async function getBarcodeSyncCounts(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ status: string; count: bigint }>>(
    `SELECT status, COUNT(*) as count FROM "AvailableBarcode" GROUP BY status`,
  );
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.status] = Number(row.count);
  }
  return result;
}

export async function getPendingRetryFailures(maxRetries = 3): Promise<number> {
  return prisma.automationFailure.count({
    where: { retryCount: { lt: maxRetries } },
  });
}
