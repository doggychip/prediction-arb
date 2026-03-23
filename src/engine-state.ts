/**
 * Shared engine state — exported so the API layer can read real-time data
 * without coupling to the main event loop.
 */

import type { ArbOpportunity } from './arb/types.js';

export interface PriceCache {
  kalshiYesBid: number;
  kalshiYesAsk: number;
  kalshiNoBid: number;
  kalshiNoAsk: number;
  polyYesBid: number;
  polyYesAsk: number;
}

export interface PairRef {
  pairId: string;
  kalshiTicker: string;
  polymarketId: string;
  polyYesTokenId: string;
  kalshiTitle: string;
  polyQuestion: string;
}

export interface EngineStats {
  oppsFound: number;
  alertsSent: number;
  suppressed: number;
  pairsTracked: number;
  kalshiTickers: number;
  polyTokens: number;
  startedAt: string;
}

// Shared mutable state
export const priceCache = new Map<string, PriceCache>();
export const kalshiTickerToPairs = new Map<string, PairRef[]>();
export const polyTokenToPairs = new Map<string, PairRef[]>();

// Recent opportunities ring buffer (last 100)
const MAX_RECENT = 100;
export const recentOpportunities: ArbOpportunity[] = [];

export function pushOpportunity(opp: ArbOpportunity) {
  recentOpportunities.unshift(opp);
  if (recentOpportunities.length > MAX_RECENT) {
    recentOpportunities.pop();
  }
}

export const stats: EngineStats = {
  oppsFound: 0,
  alertsSent: 0,
  suppressed: 0,
  pairsTracked: 0,
  kalshiTickers: 0,
  polyTokens: 0,
  startedAt: new Date().toISOString(),
};
