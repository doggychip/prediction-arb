import type { ArbOpportunity, ArbAnalysis, ArbDirectionResult, ArbStrategy } from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('arb-detector');

/** Kalshi fee rate: ~7% on profit (fee on winnings above cost basis) */
const KALSHI_FEE_RATE = 0.07;

/** Minimum spread in cents to consider an opportunity */
const MIN_SPREAD_CENTS = 1;

export interface PairPrices {
  pairId: string;
  kalshiTicker: string;
  polymarketId: string;

  // Kalshi prices in cents
  kalshiYesBid: number;
  kalshiYesAsk: number;
  kalshiNoBid: number;
  kalshiNoAsk: number;

  // Polymarket prices in cents (already normalized from dollars)
  polyYesBid: number;
  polyYesAsk: number;

  // Optional depth info (in dollars)
  kalshiDepthDollars?: number;
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
 * Estimate Kalshi fees on a trade.
 * Kalshi charges a fee on profit (winnings - cost).
 * For a contract bought at `askCents`, payout is 100 cents.
 * Profit = 100 - askCents. Fee = profit * rate.
 */
function estimateKalshiFee(askCents: number): number {
  const profit = Math.max(0, 100 - askCents);
  return Math.round(profit * KALSHI_FEE_RATE);
}

/**
 * Analyze arb opportunities for a matched market pair.
 *
 * Two directions:
 * 1. Buy YES on Kalshi (at yes_ask) + Buy NO on Polymarket (at poly_no_ask)
 *    poly_no_ask = 100 - poly_yes_bid (since YES + NO = $1.00)
 *    Cost = kalshi_yes_ask + (100 - poly_yes_bid)
 *
 * 2. Buy NO on Kalshi (at no_ask) + Buy YES on Polymarket (at poly_yes_ask)
 *    kalshi_no_ask = 100 - kalshi_yes_bid
 *    Cost = (100 - kalshi_yes_bid) + poly_yes_ask
 */
export function analyzeArb(prices: PairPrices): ArbAnalysis {
  // Derive NO prices from YES prices
  // Kalshi provides both sides directly; Polymarket we compute from YES
  const polyNoAsk = 100 - prices.polyYesBid; // cost to buy NO on Poly
  const polyNoBid = 100 - prices.polyYesAsk; // what you'd get selling NO on Poly

  const kalshiNoAsk = prices.kalshiNoAsk > 0 ? prices.kalshiNoAsk : (100 - prices.kalshiYesBid);
  const kalshiNoBid = prices.kalshiNoBid > 0 ? prices.kalshiNoBid : (100 - prices.kalshiYesAsk);

  // Direction 1: Buy YES on Kalshi + Buy NO on Polymarket
  const cost1 = prices.kalshiYesAsk + polyNoAsk;
  const gross1 = 100 - cost1;
  const fees1 = estimateKalshiFee(prices.kalshiYesAsk);
  const net1 = gross1 - fees1;

  // Direction 2: Buy NO on Kalshi + Buy YES on Polymarket
  const cost2 = kalshiNoAsk + prices.polyYesAsk;
  const gross2 = 100 - cost2;
  const fees2 = estimateKalshiFee(kalshiNoAsk);
  const net2 = gross2 - fees2;

  const availableDepth = Math.min(
    prices.kalshiDepthDollars ?? 0,
    prices.polyDepthDollars ?? 0,
  );

  const direction1: ArbDirectionResult = {
    strategy: 'kalshi_yes_poly_no',
    cost: cost1,
    grossSpread: gross1,
    estimatedFees: fees1,
    netSpread: net1,
    availableDepthDollars: availableDepth,
  };

  const direction2: ArbDirectionResult = {
    strategy: 'kalshi_no_poly_yes',
    cost: cost2,
    grossSpread: gross2,
    estimatedFees: fees2,
    netSpread: net2,
    availableDepthDollars: availableDepth,
  };

  // Pick the best direction if any has positive net spread
  let best: ArbOpportunity | null = null;

  const bestDirection = net1 >= net2 ? direction1 : direction2;
  if (bestDirection.netSpread >= MIN_SPREAD_CENTS) {
    best = {
      pairId: prices.pairId,
      kalshiTicker: prices.kalshiTicker,
      polymarketId: prices.polymarketId,
      kalshiYesBid: prices.kalshiYesBid,
      kalshiYesAsk: prices.kalshiYesAsk,
      kalshiNoBid: kalshiNoBid,
      kalshiNoAsk: kalshiNoAsk,
      polyYesBid: prices.polyYesBid,
      polyYesAsk: prices.polyYesAsk,
      polyNoBid: polyNoBid,
      polyNoAsk: polyNoAsk,
      bestSpreadCents: bestDirection.grossSpread,
      strategy: bestDirection.strategy,
      estimatedFeesCents: bestDirection.estimatedFees,
      netSpreadCents: bestDirection.netSpread,
      availableDepthDollars: bestDirection.availableDepthDollars,
      detectedAt: new Date().toISOString(),
    };

    logger.info(
      `Arb found: ${bestDirection.strategy} | gross=${bestDirection.grossSpread}¢ net=${bestDirection.netSpread}¢ | ` +
      `${prices.kalshiTicker} ↔ ${prices.polymarketId}`,
    );
  }

  return { direction1, direction2, best };
}
