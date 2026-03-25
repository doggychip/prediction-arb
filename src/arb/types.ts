/** Arbitrage-specific types */

/** Strategy direction for the arb trade */
export type ArbStrategy = string;

/** A detected arbitrage opportunity */
export interface ArbOpportunity {
  pairId: string;
  polymarketId: string;

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

/** Result of arb analysis */
export interface ArbAnalysis {
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
