/** Underlying asset symbol on Binance — fair-value strategy supports BTC and ETH only. */
export type BinanceSymbol = 'BTCUSDT' | 'ETHUSDT';

/** Spot trade event emitted by BinanceWebSocket. */
export interface BinanceSpotUpdate {
  symbol: BinanceSymbol;
  /** Last trade price in cents (USD-quoted). BTC@$100k = 10_000_000 cents. */
  priceCents: number;
  timestampMs: number;
}
