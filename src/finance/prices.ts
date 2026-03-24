/**
 * Shared price cache — populated by WebSocket updates in index.ts,
 * read by finance modules for mark-to-market calculations.
 */

export interface PriceCacheEntry {
  kalshiYesBid: number;
  kalshiYesAsk: number;
  kalshiNoBid: number;
  kalshiNoAsk: number;
  polyYesBid: number;
  polyYesAsk: number;
  updatedAt: number; // Date.now()
}

/** Singleton price cache keyed by pairId */
const priceCache = new Map<string, PriceCacheEntry>();

export function getPriceCache(): Map<string, PriceCacheEntry> {
  return priceCache;
}

export function updatePriceCache(pairId: string, entry: PriceCacheEntry): void {
  priceCache.set(pairId, entry);
}

export function getPriceCacheEntry(pairId: string): PriceCacheEntry | undefined {
  return priceCache.get(pairId);
}

/**
 * Get the current market price (mid-price in cents) for a position,
 * given a pairId and side (yes/no) and platform.
 * Returns undefined if no price data available.
 */
export function getCurrentMarketPrice(
  pairId: string,
  platform: 'kalshi' | 'polymarket',
  side: 'yes' | 'no',
): number | undefined {
  const entry = priceCache.get(pairId);
  if (!entry) return undefined;

  if (platform === 'kalshi') {
    if (side === 'yes') {
      const bid = entry.kalshiYesBid;
      const ask = entry.kalshiYesAsk;
      if (bid > 0 && ask > 0) return Math.round((bid + ask) / 2);
      return bid > 0 ? bid : ask > 0 ? ask : undefined;
    } else {
      const bid = entry.kalshiNoBid;
      const ask = entry.kalshiNoAsk;
      if (bid > 0 && ask > 0) return Math.round((bid + ask) / 2);
      return bid > 0 ? bid : ask > 0 ? ask : undefined;
    }
  } else {
    // Polymarket — we only track yes bid/ask
    if (side === 'yes') {
      const bid = entry.polyYesBid;
      const ask = entry.polyYesAsk;
      if (bid > 0 && ask > 0) return Math.round((bid + ask) / 2);
      return bid > 0 ? bid : ask > 0 ? ask : undefined;
    } else {
      // No side = 100 - yes price
      const bid = entry.polyYesBid;
      const ask = entry.polyYesAsk;
      if (bid > 0 && ask > 0) return 100 - Math.round((bid + ask) / 2);
      if (bid > 0) return 100 - bid;
      if (ask > 0) return 100 - ask;
      return undefined;
    }
  }
}
