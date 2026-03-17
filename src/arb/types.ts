/** Arbitrage-specific types */

/** Strategy direction for the arb trade */
export type ArbStrategy = 'kalshi_yes_poly_no' | 'kalshi_no_poly_yes';

/** A detected arbitrage opportunity */
export interface ArbOpportunity {
  pairId: string;
  kalshiTicker: string;
  polymarketId: string;

  // Kalshi prices (cents)
  kalshiYesBid: number;
  kalshiYesAsk: number;
  kalshiNoBid: number;
  kalshiNoAsk: number;

  // Polymarket prices (cents, normalized from dollars)
  polyYesBid: number;
  polyYesAsk: number;
  polyNoBid: number;
  polyNoAsk: number;

  // Calculated
  bestSpreadCents: number;
  strategy: ArbStrategy;
  estimatedFeesCents: number;
  netSpreadCents: number;
  availableDepthDollars: number;

  detectedAt: string;
}

/** Result of arb analysis for both directions */
export interface ArbAnalysis {
  /** kalshi_yes + poly_no direction */
  direction1: ArbDirectionResult;
  /** kalshi_no + poly_yes direction */
  direction2: ArbDirectionResult;
  /** Best opportunity if any spread is positive */
  best: ArbOpportunity | null;
}

export interface ArbDirectionResult {
  strategy: ArbStrategy;
  cost: number; // cents — total cost to enter both legs
  grossSpread: number; // cents — 100 - cost (profit before fees)
  estimatedFees: number; // cents
  netSpread: number; // cents — gross - fees
  availableDepthDollars: number;
}
