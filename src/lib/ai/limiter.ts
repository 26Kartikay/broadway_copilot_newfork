/**
 * A simple rate limiter that ensures a maximum number of concurrent requests
 * and a minimum interval between requests.
 */
export class Limiter {
  private queue: (() => Promise<any>)[] = [];
  private activeCount = 0;
  private lastRequestTime = 0;

  constructor(
    private maxConcurrent: number,
    private minIntervalMs: number,
  ) {}

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const waitTime = Math.max(0, this.minIntervalMs - timeSinceLastRequest);

    if (waitTime > 0) {
      setTimeout(() => this.processQueue(), waitTime);
      return;
    }

    const task = this.queue.shift();
    if (task) {
      this.activeCount++;
      this.lastRequestTime = Date.now();
      try {
        await task();
      } finally {
        this.activeCount--;
        this.processQueue();
      }
    }
  }
}

// Default limiter for OpenAI (3 requests per second, max 5 concurrent)
export const openAiLimiter = new Limiter(5, 333);
