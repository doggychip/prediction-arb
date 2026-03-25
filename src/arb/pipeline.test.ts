import { describe, it, expect } from 'vitest';
import { analyzeArb, type PairPrices, type ArbThresholds } from './detector.js';

/**
 * Integration-style tests for the arb detection pipeline.
 * Tests the full flow: price update → cache → arb analysis → opportunity detection.
 * Simulates what handlePriceUpdate does without needing a real DB or WebSocket.
 */

const thresholds: ArbThresholds = {
  kalshiFeeRate: 0.07,
  polymarketFeeRate: 0.02,
  minSpreadCents: 1,
  suspectSpreadCents: 20,
};

interface PipelineCache {
  kalshiYesBid: number;
  kalshiYesAsk: number;
  kalshiNoBid: number;
  kalshiNoAsk: number;
  polyYesBid: number;
  polyYesAsk: number;
  kalshiDepthDollars: number;
  polyDepthDollars: number;
}

function applyKalshiUpdate(
  cache: PipelineCache,
  update: { yesBid?: number; yesAsk?: number; noBid?: number; noAsk?: number; depth?: number },
): PipelineCache {
  return {
    ...cache,
    ...(update.yesBid !== undefined && { kalshiYesBid: update.yesBid }),
    ...(update.yesAsk !== undefined && { kalshiYesAsk: update.yesAsk }),
    ...(update.noBid !== undefined && { kalshiNoBid: update.noBid }),
    ...(update.noAsk !== undefined && { kalshiNoAsk: update.noAsk }),
    ...(update.depth !== undefined && { kalshiDepthDollars: update.depth }),
  };
}

function applyPolyUpdate(
  cache: PipelineCache,
  update: { yesBid?: number; yesAsk?: number; depth?: number },
  polarityInverted = false,
): PipelineCache {
  if (polarityInverted) {
    return {
      ...cache,
      ...(update.yesBid !== undefined && { polyYesBid: 100 - update.yesBid }),
      ...(update.yesAsk !== undefined && { polyYesAsk: 100 - update.yesAsk }),
      ...(update.depth !== undefined && { polyDepthDollars: update.depth }),
    };
  }
  return {
    ...cache,
    ...(update.yesBid !== undefined && { polyYesBid: update.yesBid }),
    ...(update.yesAsk !== undefined && { polyYesAsk: update.yesAsk }),
    ...(update.depth !== undefined && { polyDepthDollars: update.depth }),
  };
}

function cacheToPrices(cache: PipelineCache, pairId = 'test'): PairPrices {
  return {
    pairId,
    kalshiTicker: 'K-TEST',
    polymarketId: 'P-TEST',
    kalshiYesBid: cache.kalshiYesBid,
    kalshiYesAsk: cache.kalshiYesAsk,
    kalshiNoBid: cache.kalshiNoBid,
    kalshiNoAsk: cache.kalshiNoAsk,
    polyYesBid: cache.polyYesBid,
    polyYesAsk: cache.polyYesAsk,
    kalshiDepthDollars: cache.kalshiDepthDollars,
    polyDepthDollars: cache.polyDepthDollars,
  };
}

const emptyCache: PipelineCache = {
  kalshiYesBid: 0,
  kalshiYesAsk: 0,
  kalshiNoBid: 0,
  kalshiNoAsk: 0,
  polyYesBid: 0,
  polyYesAsk: 0,
  kalshiDepthDollars: 0,
  polyDepthDollars: 0,
};

describe('arb detection pipeline', () => {
  it('detects arb after sequential price updates from both platforms', () => {
    let cache = { ...emptyCache };

    // Kalshi update: YES ask = 45
    cache = applyKalshiUpdate(cache, { yesBid: 43, yesAsk: 45, noBid: 53, noAsk: 55 });

    // No arb yet — no Polymarket prices
    const prices1 = cacheToPrices(cache);
    expect(prices1.polyYesBid).toBe(0);

    // Polymarket update: YES bid = 60
    cache = applyPolyUpdate(cache, { yesBid: 60, yesAsk: 62 });

    // Now we have prices from both sides
    const prices2 = cacheToPrices(cache);
    const result = analyzeArb(prices2, thresholds);
    expect(result.best).not.toBeNull();
    expect(result.best!.strategy).toBe('kalshi_yes_poly_no');
    expect(result.best!.bestSpreadCents).toBe(15);
  });

  it('handles polarity inversion correctly', () => {
    let cache = { ...emptyCache };

    // Kalshi: YES ask = 60 (market expects YES)
    cache = applyKalshiUpdate(cache, { yesBid: 58, yesAsk: 60, noBid: 38, noAsk: 42 });

    // Polymarket: YES bid = 55 (but polarity is inverted, so this means NO = 55)
    // After inversion: polyYesBid = 100 - 55 = 45, polyYesAsk = 100 - 53 = 47
    cache = applyPolyUpdate(cache, { yesBid: 55, yesAsk: 53 }, true);

    expect(cache.polyYesBid).toBe(45);
    expect(cache.polyYesAsk).toBe(47);

    const prices = cacheToPrices(cache);
    const result = analyzeArb(prices, thresholds);
    // Direction 1: cost = 60 + (100-45) = 115, gross = -15 → negative
    // Direction 2: cost = 42 + 47 = 89, gross = 11 → positive
    expect(result.direction2.grossSpread).toBe(11);
  });

  it('passes depth info through to arb analysis', () => {
    let cache = { ...emptyCache };

    cache = applyKalshiUpdate(cache, {
      yesBid: 43,
      yesAsk: 45,
      noBid: 53,
      noAsk: 55,
      depth: 5000,
    });
    cache = applyPolyUpdate(cache, { yesBid: 60, yesAsk: 62, depth: 3000 });

    const prices = cacheToPrices(cache);
    expect(prices.kalshiDepthDollars).toBe(5000);
    expect(prices.polyDepthDollars).toBe(3000);

    const result = analyzeArb(prices, thresholds);
    expect(result.best).not.toBeNull();
    expect(result.best!.availableDepthDollars).toBe(3000); // min of both
  });

  it('incremental updates only change affected fields', () => {
    let cache = { ...emptyCache };

    // Full initial update
    cache = applyKalshiUpdate(cache, { yesBid: 50, yesAsk: 52, noBid: 46, noAsk: 48 });
    cache = applyPolyUpdate(cache, { yesBid: 51, yesAsk: 53 });

    // Partial Kalshi update — only yesBid changes
    cache = applyKalshiUpdate(cache, { yesBid: 49 });
    expect(cache.kalshiYesBid).toBe(49);
    expect(cache.kalshiYesAsk).toBe(52); // unchanged
    expect(cache.kalshiNoBid).toBe(46); // unchanged

    // Partial Poly update — only yesAsk changes
    cache = applyPolyUpdate(cache, { yesAsk: 54 });
    expect(cache.polyYesBid).toBe(51); // unchanged
    expect(cache.polyYesAsk).toBe(54);
  });

  it('multi-outcome guard: neg_risk markets should be skipped upstream', () => {
    // This tests the design principle that neg_risk markets are filtered out
    // before they reach the arb detector. The detector assumes YES+NO=100.
    // If somehow a multi-outcome market slips through, the math breaks:
    const prices: PairPrices = {
      pairId: 'multi-outcome',
      kalshiTicker: 'K1',
      polymarketId: 'P1',
      kalshiYesBid: 30,
      kalshiYesAsk: 32,
      kalshiNoBid: 30,
      kalshiNoAsk: 32,
      // In a multi-outcome market, YES could be 30 and NO could also be 30
      // (because there are more outcomes). The detector derives NO = 100-YES = 70,
      // which would be wrong. So we verify the assumption is documented.
      polyYesBid: 30,
      polyYesAsk: 32,
    };

    const result = analyzeArb(prices, thresholds);
    // Direction 2: cost = 32 + 32 = 64, gross = 36 → suspect (>20)
    // This correctly gets filtered as suspect, showing the safety net works
    expect(result.best).toBeNull();
  });

  it('detects spread narrowing across multiple updates', () => {
    let cache = { ...emptyCache };

    // Initial: big spread
    cache = applyKalshiUpdate(cache, { yesBid: 40, yesAsk: 42, noBid: 56, noAsk: 58 });
    cache = applyPolyUpdate(cache, { yesBid: 58, yesAsk: 60 });

    const result1 = analyzeArb(cacheToPrices(cache), thresholds);
    expect(result1.best).not.toBeNull();
    const spread1 = result1.best!.netSpreadCents;

    // Prices converge — spread narrows
    cache = applyKalshiUpdate(cache, { yesAsk: 48 });
    cache = applyPolyUpdate(cache, { yesBid: 53 });

    const result2 = analyzeArb(cacheToPrices(cache), thresholds);
    if (result2.best) {
      expect(result2.best.netSpreadCents).toBeLessThan(spread1);
    }
    // Spread may have disappeared entirely, which is also valid
  });
});
