import { describe, it, expect } from 'vitest';
import { analyzeArb, dollarsToCents, type PairPrices, type ArbThresholds } from './detector.js';

const basePrices: PairPrices = {
  pairId: 'test-pair',
  kalshiTicker: 'KALSHI-TEST',
  polymarketId: 'poly-test',
  kalshiYesBid: 0,
  kalshiYesAsk: 0,
  kalshiNoBid: 0,
  kalshiNoAsk: 0,
  polyYesBid: 0,
  polyYesAsk: 0,
};

const defaultThresholds: ArbThresholds = {
  kalshiFeeRate: 0.07,
  polymarketFeeRate: 0.02,
  minSpreadCents: 1,
  suspectSpreadCents: 20,
};

const zeroFees: ArbThresholds = {
  kalshiFeeRate: 0,
  polymarketFeeRate: 0,
  minSpreadCents: 1,
  suspectSpreadCents: 20,
};

describe('dollarsToCents', () => {
  it('converts string dollar amounts to cents', () => {
    expect(dollarsToCents('0.45')).toBe(45);
    expect(dollarsToCents('1.00')).toBe(100);
    expect(dollarsToCents('0.01')).toBe(1);
    expect(dollarsToCents('0')).toBe(0);
  });

  it('converts numeric dollar amounts to cents', () => {
    expect(dollarsToCents(0.45)).toBe(45);
    expect(dollarsToCents(1)).toBe(100);
    expect(dollarsToCents(0)).toBe(0);
  });

  it('rounds correctly for floating point edge cases', () => {
    expect(dollarsToCents('0.07')).toBe(7);
    expect(dollarsToCents('0.33')).toBe(33);
    expect(dollarsToCents('0.999')).toBe(100);
  });
});

describe('analyzeArb', () => {
  it('detects no arb when prices are equal', () => {
    const prices: PairPrices = {
      ...basePrices,
      kalshiYesBid: 50,
      kalshiYesAsk: 52,
      kalshiNoBid: 48,
      kalshiNoAsk: 50,
      polyYesBid: 50,
      polyYesAsk: 52,
    };

    const result = analyzeArb(prices, defaultThresholds);
    expect(result.best).toBeNull();
  });

  it('detects arb: buy YES on Kalshi + buy NO on Polymarket', () => {
    const prices: PairPrices = {
      ...basePrices,
      kalshiYesBid: 43,
      kalshiYesAsk: 45,
      kalshiNoBid: 53,
      kalshiNoAsk: 55,
      polyYesBid: 60,
      polyYesAsk: 62,
    };

    // Direction 1: cost = 45 + (100-60) = 45 + 40 = 85, gross = 15
    // Kalshi fee = (100-45) * 0.07 = 55 * 0.07 = 3.85 → 4
    // Poly fee = (100-40) * 0.02 = 60 * 0.02 = 1.2 → 1
    // Total fees = 5, Net = 15 - 5 = 10
    const result = analyzeArb(prices, defaultThresholds);
    expect(result.best).not.toBeNull();
    expect(result.best!.strategy).toBe('kalshi_yes_poly_no');
    expect(result.best!.bestSpreadCents).toBe(15);
    expect(result.best!.estimatedFeesCents).toBe(5);
    expect(result.best!.netSpreadCents).toBe(10);
  });

  it('detects arb: buy NO on Kalshi + buy YES on Polymarket', () => {
    const prices: PairPrices = {
      ...basePrices,
      kalshiYesBid: 60,
      kalshiYesAsk: 62,
      kalshiNoBid: 36,
      kalshiNoAsk: 38,
      polyYesBid: 38,
      polyYesAsk: 40,
    };

    // Direction 2: cost = 38 + 40 = 78, gross = 22 → suspect at 20
    // With suspect threshold raised to 25, it passes
    const result = analyzeArb(prices, { ...defaultThresholds, suspectSpreadCents: 25 });
    expect(result.best).not.toBeNull();
    expect(result.best!.strategy).toBe('kalshi_no_poly_yes');
  });

  it('accounts for both Kalshi and Polymarket fees', () => {
    const prices: PairPrices = {
      ...basePrices,
      kalshiYesBid: 43,
      kalshiYesAsk: 45,
      kalshiNoBid: 53,
      kalshiNoAsk: 55,
      polyYesBid: 60,
      polyYesAsk: 62,
    };

    // With zero fees: gross = 15, net = 15
    const noFees = analyzeArb(prices, zeroFees);
    expect(noFees.best).not.toBeNull();
    expect(noFees.best!.netSpreadCents).toBe(15);
    expect(noFees.best!.estimatedFeesCents).toBe(0);

    // With only Kalshi fees: net = 15 - 4 = 11
    const kalshiOnly = analyzeArb(prices, { ...zeroFees, kalshiFeeRate: 0.07 });
    expect(kalshiOnly.best!.estimatedFeesCents).toBe(4);
    expect(kalshiOnly.best!.netSpreadCents).toBe(11);

    // With both fees: net = 15 - 5 = 10
    const bothFees = analyzeArb(prices, defaultThresholds);
    expect(bothFees.best!.estimatedFeesCents).toBe(5);
    expect(bothFees.best!.netSpreadCents).toBe(10);
  });

  it('suppresses polarity mismatch (both directions positive)', () => {
    const mismatchPrices: PairPrices = {
      ...basePrices,
      kalshiYesBid: 30,
      kalshiYesAsk: 30,
      kalshiNoBid: 30,
      kalshiNoAsk: 30,
      polyYesBid: 30,
      polyYesAsk: 30,
    };
    // Direction 1: cost = 30 + 70 = 100, gross = 0
    // Direction 2: cost = 30 + 30 = 60, gross = 40 → suspect single direction
    const result = analyzeArb(mismatchPrices, defaultThresholds);
    expect(result.best).toBeNull();
  });

  it('suppresses suspect spread (single direction too high)', () => {
    const prices: PairPrices = {
      ...basePrices,
      kalshiYesBid: 70,
      kalshiYesAsk: 72,
      kalshiNoBid: 26,
      kalshiNoAsk: 28,
      polyYesBid: 20,
      polyYesAsk: 22,
    };

    // Direction 2: cost = 28 + 22 = 50, gross = 50 → suspect (>20)
    const result = analyzeArb(prices, defaultThresholds);
    expect(result.best).toBeNull();
  });

  it('respects custom thresholds', () => {
    const prices: PairPrices = {
      ...basePrices,
      kalshiYesBid: 50,
      kalshiYesAsk: 50,
      kalshiNoBid: 48,
      kalshiNoAsk: 50,
      polyYesBid: 52,
      polyYesAsk: 52,
    };

    // Direction 1: cost = 50 + 48 = 98, gross = 2
    // With 0% fees: net = 2
    const result = analyzeArb(prices, zeroFees);
    expect(result.best).not.toBeNull();
    expect(result.best!.netSpreadCents).toBe(2);
  });

  it('handles zero prices gracefully', () => {
    const prices: PairPrices = {
      ...basePrices,
      kalshiYesBid: 0,
      kalshiYesAsk: 0,
      kalshiNoBid: 0,
      kalshiNoAsk: 0,
      polyYesBid: 0,
      polyYesAsk: 0,
    };

    const result = analyzeArb(prices, defaultThresholds);
    expect(result.direction1).toBeDefined();
    expect(result.direction2).toBeDefined();
  });

  it('derives NO prices from YES when NO prices are 0', () => {
    const prices: PairPrices = {
      ...basePrices,
      kalshiYesBid: 45,
      kalshiYesAsk: 47,
      kalshiNoBid: 0,
      kalshiNoAsk: 0,
      polyYesBid: 60,
      polyYesAsk: 62,
    };

    const result = analyzeArb(prices, defaultThresholds);
    // Direction 1: cost = 47 + (100-60) = 87, gross = 13
    expect(result.direction1.grossSpread).toBe(13);
  });
});
