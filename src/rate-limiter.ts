import { createLogger } from './logger.js';
import type { PriceUpdate } from './types.js';

const logger = createLogger('rate-limiter');

export interface RateLimiterConfig {
  /** Max events processed per second */
  maxEventsPerSecond: number;
  /** Max queue size before dropping oldest events */
  maxQueueSize: number;
}

/**
 * Rate limiter with backpressure for WebSocket price updates.
 * Buffers events and drains them at a controlled rate.
 * When the queue overflows, oldest events are dropped (newest prices are more relevant).
 */
export class PriceUpdateRateLimiter {
  private queue: PriceUpdate[] = [];
  private handler: (update: PriceUpdate) => void;
  private maxEventsPerSecond: number;
  private maxQueueSize: number;
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private dropped = 0;
  private processed = 0;

  constructor(handler: (update: PriceUpdate) => void, config: RateLimiterConfig) {
    this.handler = handler;
    this.maxEventsPerSecond = config.maxEventsPerSecond;
    this.maxQueueSize = config.maxQueueSize;
  }

  /** Enqueue a price update for processing. */
  enqueue(update: PriceUpdate): void {
    if (this.queue.length >= this.maxQueueSize) {
      // Drop oldest events (newest prices are more relevant for arb detection)
      this.queue.shift();
      this.dropped++;
    }
    this.queue.push(update);
  }

  /** Start draining the queue at the configured rate. */
  start(): void {
    if (this.drainTimer) return;

    const intervalMs = Math.max(1, Math.floor(1000 / this.maxEventsPerSecond));
    this.drainTimer = setInterval(() => {
      const batchSize = Math.min(this.queue.length, Math.ceil(this.maxEventsPerSecond / 10));
      for (let i = 0; i < batchSize; i++) {
        const update = this.queue.shift();
        if (!update) break;
        try {
          this.handler(update);
          this.processed++;
        } catch (err) {
          logger.error('Error processing price update', { error: (err as Error).message });
        }
      }
    }, intervalMs);

    logger.info(
      `Rate limiter started: ${this.maxEventsPerSecond} events/s, queue max ${this.maxQueueSize}`,
    );
  }

  /** Stop the drain timer. */
  stop(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  /** Get current stats. */
  getStats(): { queueSize: number; dropped: number; processed: number } {
    return {
      queueSize: this.queue.length,
      dropped: this.dropped,
      processed: this.processed,
    };
  }
}
