/** Polymarket-specific types */

export interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  markets: PolymarketMarket[];
  active: boolean;
  closed: boolean;
  tags: PolymarketTag[];
}

export interface PolymarketMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string; // JSON array: '["Yes","No"]'
  outcomePrices: string; // JSON array: '["0.45","0.55"]'
  volume: string;
  volume24hr: number;
  liquidity: string;
  active: boolean;
  closed: boolean;
  clobTokenIds: string; // JSON array of token IDs
  enableOrderBook: boolean;
  description: string;
  endDate: string;
  tags: PolymarketTag[];
  neg_risk: boolean;
  eventSlug: string;
  eventTitle: string;
}

export interface PolymarketTag {
  id: string;
  label: string;
  slug: string;
}

export interface PolymarketGetEventsParams {
  active?: boolean;
  closed?: boolean;
  limit?: number;
  offset?: number;
  order?: string;
  ascending?: boolean;
  tag_id?: string;
  slug?: string;
}

export interface PolymarketGetMarketsParams {
  active?: boolean;
  closed?: boolean;
  limit?: number;
  offset?: number;
  slug?: string;
}

/** Parsed token IDs from clobTokenIds */
export interface PolymarketTokenIds {
  yes: string;
  no: string;
}

/** Polymarket WebSocket subscribe message */
export interface PolymarketWsSubscribeMessage {
  type: 'market';
  assets_ids: string[];
  custom_feature_enabled: boolean;
}

/** Polymarket WebSocket event types */
export interface PolymarketWsBookEvent {
  event_type: 'book';
  asset_id: string;
  market: string;
  bids: PolymarketWsOrderbookLevel[];
  asks: PolymarketWsOrderbookLevel[];
  timestamp: string;
  hash: string;
}

export interface PolymarketWsOrderbookLevel {
  price: string;
  size: string;
}

export interface PolymarketWsPriceChangeEvent {
  event_type: 'price_change';
  asset_id: string;
  market: string;
  price: string;
  side: string;
  size: string;
  timestamp: string;
}

export interface PolymarketWsLastTradePriceEvent {
  event_type: 'last_trade_price';
  asset_id: string;
  market: string;
  price: string;
  timestamp: string;
}

export interface PolymarketWsBestBidAskEvent {
  event_type: 'best_bid_ask';
  asset_id: string;
  market: string;
  best_bid: string;
  best_ask: string;
  timestamp: string;
}

export type PolymarketWsEvent =
  | PolymarketWsBookEvent
  | PolymarketWsPriceChangeEvent
  | PolymarketWsLastTradePriceEvent
  | PolymarketWsBestBidAskEvent;
