import { prisma } from '../lib/prisma';
import { AnalyticsEventInput } from '../types/analytics';
import { logger } from '../utils/logger';

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5000;

class AnalyticsService {
  private queue: AnalyticsEventInput[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.startTimer();
  }

  public track(event: AnalyticsEventInput) {
    this.queue.push(event);
    if (this.queue.length >= BATCH_SIZE) {
      void this.flush();
    }
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  public async flush() {
    if (this.queue.length === 0) return;

    const eventsToProcess = [...this.queue];
    this.queue = [];

    try {
      const data = eventsToProcess.map((event) => ({
        eventName: event.eventName,
        userId: event.userId ?? null,
        sessionId: event.sessionId,
        vibeSessionId: event.vibeSessionId,
        flowType: event.flowType,
        platform: event.platform ?? null,
        properties: event.properties as any,
        createdAt: event.timestamp ? new Date(event.timestamp) : new Date(),
      }));

      await prisma.analyticsEvent.createMany({
        data,
      });

      logger.info({ count: eventsToProcess.length }, 'Analytics events flushed to DB');
    } catch (error) {
      logger.error({ error, events: eventsToProcess }, 'Failed to flush analytics events');
      // Re-queue events to retry later
      this.queue.push(...eventsToProcess);
    }
  }

  public async shutdown() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    await this.flush();
  }
}

export const analyticsService = new AnalyticsService();
