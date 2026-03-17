/** Kalshi-specific types — matches actual API response fields */

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  status: string;
  market_type: string;

  // Prices are dollar strings like "0.0800"
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  no_bid_dollars: string;
  no_ask_dollars: string;
  last_price_dollars: string;
  notional_value_dollars: string;

  // Volume and OI are float-point strings
  volume_fp: string;
  volume_24h_fp: string;
  open_interest_fp: string;
  liquidity_dollars: string;

  // Sizes
  yes_bid_size_fp: string;
  yes_ask_size_fp: string;

  // Rules and timing
  rules_primary: string;
  rules_secondary: string;
  close_time: string;
  open_time: string;
  expiration_time: string;
  expected_expiration_time: string;

  // Resolution
  result: string;
  expiration_value: string;

  // MVE (multivariate/parlay) fields
  mve_collection_ticker?: string;
  mve_selected_legs?: any[];

  // Misc
  tick_size: number;
  settlement_timer_seconds: number;
  can_close_early: boolean;
  response_price_units: string;
  yes_sub_title: string;
  no_sub_title: string;
  strike_type: string;
}

export interface KalshiEvent {
  event_ticker: string;
  title: string;
  subtitle: string;
  category: string;
  markets: KalshiMarket[];
  series_ticker: string;
  status: string;
}

export interface KalshiOrderbook {
  yes: KalshiOrderbookSide[];
  no: KalshiOrderbookSide[];
}

export interface KalshiOrderbookSide {
  price: number;
  quantity: number;
}

export interface KalshiTrade {
  ticker: string;
  trade_id: string;
  side: string;
  yes_price: number;
  no_price: number;
  count: number;
  created_time: string;
  taker_side: string;
}

export interface KalshiGetEventsParams {
  limit?: number;
  cursor?: string;
  with_nested_markets?: boolean;
  status?: string;
  series_ticker?: string;
}

export interface KalshiGetMarketsParams {
  limit?: number;
  cursor?: string;
  event_ticker?: string;
  series_ticker?: string;
  status?: string;
  tickers?: string;
  mve_filter?: 'only' | 'exclude';
  min_close_ts?: number;
  max_close_ts?: number;
}

export interface KalshiGetTradesParams {
  limit?: number;
  cursor?: string;
  ticker?: string;
  min_ts?: number;
  max_ts?: number;
}

/** Kalshi WebSocket message types */
export interface KalshiWsSubscribeMessage {
  id: number;
  cmd: 'subscribe' | 'unsubscribe';
  params: {
    channels: string[];
    market_tickers: string[];
  };
}

export interface KalshiWsTickerMessage {
  type: 'ticker';
  msg: {
    market_ticker: string;
    yes_bid_dollars?: string;
    yes_ask_dollars?: string;
    no_bid_dollars?: string;
    no_ask_dollars?: string;
    last_price_dollars?: string;
    volume_fp?: string;
  };
}

export interface KalshiWsTradeMessage {
  type: 'trade';
  msg: {
    market_ticker: string;
    yes_price: number;
    no_price: number;
    count: number;
    taker_side: string;
    trade_id: string;
    ts: number;
  };
}

export interface KalshiWsOrderbookSnapshotMessage {
  type: 'orderbook_snapshot';
  msg: {
    market_ticker: string;
    yes: KalshiOrderbookSide[];
    no: KalshiOrderbookSide[];
  };
}

export interface KalshiWsOrderbookDeltaMessage {
  type: 'orderbook_delta';
  msg: {
    market_ticker: string;
    price: number;
    delta: number;
    side: 'yes' | 'no';
  };
}

export type KalshiWsMessage =
  | KalshiWsTickerMessage
  | KalshiWsTradeMessage
  | KalshiWsOrderbookSnapshotMessage
  | KalshiWsOrderbookDeltaMessage;

/** Helper: convert Kalshi dollar string to cents */
export function kalshiDollarsToCents(dollars: string | undefined): number {
  if (!dollars) return 0;
  return Math.round(parseFloat(dollars) * 100);
}
