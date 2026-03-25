/** Shared types across the prediction-arb project */

/** Platform identifier */
export type Platform = 'polymarket';

/** Common price representation in cents */
export interface PriceCents {
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
}

/** Orderbook level */
export interface OrderbookLevel {
  price: number; // cents
  quantity: number;
}

/** Orderbook snapshot */
export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: string;
}

/** Market pair linking two markets on Polymarket (or across platforms) */
export interface MarketPair {
  id: string;
  polymarketId: string;
  matchConfidence: number; // 0-1
  resolutionDivergenceRisk: number; // 0-1
  matchMethod: 'manual' | 'llm' | 'exact' | 'string_similarity';
  status: 'pending_review' | 'approved' | 'blocked';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Price update event emitted by WebSocket clients */
export interface PriceUpdate {
  platform: Platform;
  ticker: string; // token ID (Polymarket)
  yesBid?: number; // cents
  yesAsk?: number; // cents
  noBid?: number; // cents
  noAsk?: number; // cents
  lastPrice?: number; // cents
  timestamp: string;
}

/** Paginated response envelope */
export interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;
}
