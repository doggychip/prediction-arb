/** Kalshi-specific types */

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  status: string;
  category: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  volume_24h: number;
  open_interest: number;
  rules_primary: string;
  rules_secondary: string;
  close_time: string;
  result: string;
  notional_value: number;
  tick_size: number;
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
  price: number; // cents
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
    yes_bid?: number;
    yes_ask?: number;
    no_bid?: number;
    no_ask?: number;
    last_price?: number;
    volume?: number;
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
