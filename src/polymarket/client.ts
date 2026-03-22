import { ClobClient } from '@polymarket/clob-client';
import type { Config } from '../config.js';
import type {
  PolymarketEvent,
  PolymarketMarket,
  PolymarketGetEventsParams,
  PolymarketGetMarketsParams,
} from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('polymarket-client');

export class PolymarketClient {
  private gammaUrl: string;
  private clobClient: ClobClient;
  private requestTimeoutMs: number;

  constructor(config: Config) {
    this.gammaUrl = config.polymarketGammaUrl;
    this.clobClient = new ClobClient(config.polymarketClobUrl, 137);
    this.requestTimeoutMs = config.requestTimeoutMs;
  }

  // --- Gamma API (market discovery) ---

  private async gammaRequest<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(`${this.gammaUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    logger.debug(`GET ${url.toString()}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Polymarket Gamma API error ${response.status}: ${response.statusText} — ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async getEvents(params?: PolymarketGetEventsParams): Promise<PolymarketEvent[]> {
    return this.gammaRequest<PolymarketEvent[]>('/events', params as Record<string, string | number | boolean>);
  }

  async getMarkets(params?: PolymarketGetMarketsParams): Promise<PolymarketMarket[]> {
    return this.gammaRequest<PolymarketMarket[]>('/markets', params as Record<string, string | number | boolean>);
  }

  async getMarket(id: string): Promise<PolymarketMarket> {
    return this.gammaRequest<PolymarketMarket>(`/markets/${encodeURIComponent(id)}`);
  }

  // --- CLOB API (orderbook and pricing) ---

  async getOrderBook(tokenId: string): Promise<any> {
    return this.clobClient.getOrderBook(tokenId);
  }

  async getPrice(tokenId: string, side: 'BUY' | 'SELL'): Promise<string> {
    // Side enum — ClobClient uses string "BUY" | "SELL"
    return this.clobClient.getPrice(tokenId, side as any);
  }

  async getBatchOrderBooks(tokenIds: string[]): Promise<any[]> {
    // The CLOB client doesn't have a native batch method exposed,
    // so we fetch them in parallel with concurrency control.
    const BATCH_SIZE = 20;
    const results: any[] = [];

    for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
      const batch = tokenIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((id) => this.getOrderBook(id).catch((err) => {
          logger.warn(`Failed to get orderbook for ${id}: ${err.message}`);
          return null;
        })),
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Fetch all active markets with automatic offset-based pagination.
   */
  async getAllMarkets(params?: PolymarketGetMarketsParams): Promise<PolymarketMarket[]> {
    const allMarkets: PolymarketMarket[] = [];
    let offset = params?.offset ?? 0;
    const limit = params?.limit ?? 100;

    while (true) {
      const markets = await this.getMarkets({ ...params, limit, offset });
      if (!markets || markets.length === 0) break;
      allMarkets.push(...markets);
      offset += markets.length;
      logger.info(`Fetched ${markets.length} Polymarket markets (total: ${allMarkets.length})`);
      if (markets.length < limit) break;
    }

    return allMarkets;
  }
}
