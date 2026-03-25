import type { ArbOpportunity, ArbAnalysis } from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('arb-detector');

/** Minimum spread in cents to consider an opportunity */
const MIN_SPREAD_CENTS = 1;

export interface PairPrices {
  pairId: string;
  polymarketId: string;

  // Polymarket prices in cents (already normalized from dollars)
  polyYesBid: number;
  polyYesAsk: number;

  // Optional depth info (in dollars)
  polyDepthDollars?: number;
}

/**
 * Convert Polymarket dollar price string to cents.
 * e.g. "0.45" → 45
 */
export function dollarsToCents(dollars: string | number): number {
  const value = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  return Math.round(value * 100);
}

/**
 * Analyze price data for a Polymarket market.
 * Checks if YES + NO pricing creates an inefficiency.
 */
export function analyzeArb(prices: PairPrices): ArbAnalysis {
  const polyNoAsk = 100 - prices.polyYesBid;
  const polyNoBid = 100 - prices.polyYesAsk;

  // Check if buying YES + NO costs less than 100¢ (guaranteed payout)
  const costYesNo = prices.polyYesAsk + polyNoAsk;
  const grossSpread = 100 - costYesNo;

  const availableDepth = prices.polyDepthDollars ?? 0;

  let best: ArbOpportunity | null = null;

  if (grossSpread >= MIN_SPREAD_CENTS) {
    best = {
      pairId: prices.pairId,
      polymarketId: prices.polymarketId,
      polyYesBid: prices.polyYesBid,
      polyYesAsk: prices.polyYesAsk,
      polyNoBid: polyNoBid,
      polyNoAsk: polyNoAsk,
      bestSpreadCents: grossSpread,
      strategy: 'poly_yes_and_no',
      estimatedFeesCents: 0,
      netSpreadCents: grossSpread,
      availableDepthDollars: availableDepth,
      detectedAt: new Date().toISOString(),
    };

    logger.info(
      `Arb found: poly_yes_and_no | gross=${grossSpread}¢ | ${prices.polymarketId}`,
    );
  }

  return { best };
}
