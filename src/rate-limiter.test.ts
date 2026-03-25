import { describe, it, expect } from 'vitest';
import { PriceUpdateRateLimiter } from './rate-limiter.js';
import type { PriceUpdate } from './types.js';

function makeUpdate(ticker = 'TEST', platform: 'kalshi' | 'polymarket' = 'kalshi'): PriceUpdate {
  return {
    platform,
    ticker,
    yesBid: 50,
    yesAsk: 52,
    timestamp: new Date().toISOString(),
  };
}

describe('PriceUpdateRateLimiter', () => {
  it('enqueues and processes events', async () => {
    const processed: PriceUpdate[] = [];
    const limiter = new PriceUpdateRateLimiter((u) => processed.push(u), {
      maxEventsPerSecond: 1000,
      maxQueueSize: 100,
    });

    limiter.enqueue(makeUpdate('A'));
    limiter.enqueue(makeUpdate('B'));
    limiter.start();

    // Wait for drain
    await new Promise((r) => setTimeout(r, 50));
    limiter.stop();

    expect(processed.length).toBe(2);
    expect(processed[0].ticker).toBe('A');
    expect(processed[1].ticker).toBe('B');
  });

  it('drops oldest events when queue overflows', () => {
    const processed: PriceUpdate[] = [];
    const limiter = new PriceUpdateRateLimiter((u) => processed.push(u), {
      maxEventsPerSecond: 1000,
      maxQueueSize: 3,
    });

    // Enqueue 5 events with max queue 3
    limiter.enqueue(makeUpdate('A'));
    limiter.enqueue(makeUpdate('B'));
    limiter.enqueue(makeUpdate('C'));
    limiter.enqueue(makeUpdate('D'));
    limiter.enqueue(makeUpdate('E'));

    const stats = limiter.getStats();
    expect(stats.queueSize).toBe(3);
    expect(stats.dropped).toBe(2);
  });

  it('tracks stats correctly', async () => {
    const limiter = new PriceUpdateRateLimiter(() => {}, {
      maxEventsPerSecond: 1000,
      maxQueueSize: 100,
    });

    limiter.enqueue(makeUpdate());
    limiter.enqueue(makeUpdate());
    limiter.start();

    await new Promise((r) => setTimeout(r, 50));
    limiter.stop();

    const stats = limiter.getStats();
    expect(stats.processed).toBe(2);
    expect(stats.dropped).toBe(0);
  });

  it('handles errors in handler without crashing', async () => {
    let callCount = 0;
    const limiter = new PriceUpdateRateLimiter(
      () => {
        callCount++;
        if (callCount === 1) throw new Error('test error');
      },
      { maxEventsPerSecond: 1000, maxQueueSize: 100 },
    );

    limiter.enqueue(makeUpdate('A'));
    limiter.enqueue(makeUpdate('B'));
    limiter.start();

    await new Promise((r) => setTimeout(r, 50));
    limiter.stop();

    // Both events processed despite error on first
    expect(callCount).toBe(2);
    expect(limiter.getStats().processed).toBe(1); // Only successful ones counted
  });
});
