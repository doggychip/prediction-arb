import type { Config } from '../config.js';
import type {
  KalshiMarket,
  KalshiEvent,
  KalshiOrderbook,
  KalshiTrade,
  KalshiGetEventsParams,
  KalshiGetMarketsParams,
  KalshiGetTradesParams,
} from './types.js';
import { createLogger } from '../logger.js';
import { KalshiMarketsResponseSchema, KalshiMarketResponseSchema } from '../validation.js';

const logger = createLogger('kalshi-client');

interface KalshiEventsResponse {
  events: KalshiEvent[];
  cursor: string;
}

interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  cursor: string;
}

interface KalshiMarketResponse {
  market: KalshiMarket;
}

interface KalshiOrderbookResponse {
  orderbook: KalshiOrderbook;
}

interface KalshiTradesResponse {
  trades: KalshiTrade[];
  cursor: string;
}

export class KalshiClient {
  private baseUrl: string;
  private requestTimeoutMs: number;

  constructor(config: Config) {
    this.baseUrl = config.kalshiBaseUrl;
    this.requestTimeoutMs = config.requestTimeoutMs;
  }

  private async request<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
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
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Kalshi API error ${response.status}: ${response.statusText} — ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async getEvents(params?: KalshiGetEventsParams): Promise<KalshiEventsResponse> {
    return this.request<KalshiEventsResponse>('/events', params as Record<string, string | number | boolean>);
  }

  async getMarkets(params?: KalshiGetMarketsParams): Promise<KalshiMarketsResponse> {
    const raw = await this.request<unknown>('/markets', params as Record<string, string | number | boolean>);
    const validated = KalshiMarketsResponseSchema.safeParse(raw);
    if (!validated.success) {
      logger.error('Kalshi markets response validation failed', { error: validated.error.message });
      throw new Error(`Kalshi API response validation failed: ${validated.error.message}`);
    }
    return validated.data as KalshiMarketsResponse;
  }

  async getMarket(ticker: string): Promise<KalshiMarket> {
    const raw = await this.request<unknown>(`/markets/${encodeURIComponent(ticker)}`);
    const validated = KalshiMarketResponseSchema.safeParse(raw);
    if (!validated.success) {
      logger.error('Kalshi market response validation failed', { error: validated.error.message });
      throw new Error(`Kalshi API response validation failed: ${validated.error.message}`);
    }
    return validated.data.market as KalshiMarket;
  }

  async getOrderbook(ticker: string, depth?: number): Promise<KalshiOrderbook> {
    const params = depth !== undefined ? { depth } : undefined;
    const resp = await this.request<KalshiOrderbookResponse>(
      `/markets/${encodeURIComponent(ticker)}/orderbook`,
      params as Record<string, number> | undefined,
    );
    return resp.orderbook;
  }

  async getTrades(params?: KalshiGetTradesParams): Promise<KalshiTradesResponse> {
    return this.request<KalshiTradesResponse>('/markets/trades', params as Record<string, string | number | boolean>);
  }

  /**
   * Fetch all markets with automatic cursor-based pagination.
   * Uses the given params as the base, iterating until no more results.
   */
  async getAllMarkets(params?: KalshiGetMarketsParams): Promise<KalshiMarket[]> {
    const allMarkets: KalshiMarket[] = [];
    let cursor: string | undefined;
    const limit = params?.limit ?? 1000;

    do {
      const response = await this.getMarkets({ ...params, limit, cursor: cursor as string | undefined });
      allMarkets.push(...response.markets);
      cursor = response.cursor || undefined;
      logger.info(`Fetched ${response.markets.length} Kalshi markets (total: ${allMarkets.length})`);
    } while (cursor);

    return allMarkets;
  }
}
