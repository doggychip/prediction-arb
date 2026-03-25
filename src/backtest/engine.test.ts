import { describe, it, expect } from 'vitest';
import { computeSummary, type TradeResult } from './engine.js';

function makeTrade(overrides: Partial<TradeResult> = {}): TradeResult {
  return {
    pairId: 'pair-1',
    kalshiTicker: 'K-TEST',
    polymarketId: 'P-TEST',
    strategy: 'kalshi_yes_poly_no',
    entryTime: '2025-01-15T12:00:00Z',
    grossSpreadCents: 10,
    estimatedFeesCents: 3,
    netSpreadCents: 7,
    availableDepthDollars: 1000,
    ...overrides,
  };
}

describe('computeSummary', () => {
  it('handles empty trades', () => {
    const summary = computeSummary([]);
    expect(summary.totalTrades).toBe(0);
    expect(summary.totalNetPnlCents).toBe(0);
    expect(summary.winRate).toBe(0);
    expect(summary.avgNetSpreadCents).toBe(0);
  });

  it('computes correct totals for single trade', () => {
    const trades = [makeTrade({ grossSpreadCents: 15, estimatedFeesCents: 5, netSpreadCents: 10 })];
    const summary = computeSummary(trades);

    expect(summary.totalTrades).toBe(1);
    expect(summary.totalGrossPnlCents).toBe(15);
    expect(summary.totalFeesCents).toBe(5);
    expect(summary.totalNetPnlCents).toBe(10);
    expect(summary.avgNetSpreadCents).toBe(10);
    expect(summary.maxNetSpreadCents).toBe(10);
    expect(summary.winRate).toBe(1);
  });

  it('computes correct totals for multiple trades', () => {
    const trades = [
      makeTrade({ netSpreadCents: 10, grossSpreadCents: 15, estimatedFeesCents: 5 }),
      makeTrade({ netSpreadCents: 5, grossSpreadCents: 8, estimatedFeesCents: 3 }),
      makeTrade({ netSpreadCents: 20, grossSpreadCents: 25, estimatedFeesCents: 5 }),
    ];
    const summary = computeSummary(trades);

    expect(summary.totalTrades).toBe(3);
    expect(summary.totalGrossPnlCents).toBe(48);
    expect(summary.totalFeesCents).toBe(13);
    expect(summary.totalNetPnlCents).toBe(35);
    expect(summary.avgNetSpreadCents).toBe(12); // 35/3 ≈ 11.67 → 12
    expect(summary.maxNetSpreadCents).toBe(20);
    expect(summary.winRate).toBe(1);
  });

  it('tracks win rate correctly with mixed results', () => {
    const trades = [
      makeTrade({ netSpreadCents: 10 }),
      makeTrade({ netSpreadCents: -2 }),
      makeTrade({ netSpreadCents: 5 }),
      makeTrade({ netSpreadCents: 0 }),
    ];
    const summary = computeSummary(trades);
    expect(summary.winRate).toBe(0.5); // 2 out of 4 are > 0
  });

  it('groups trades by strategy', () => {
    const trades = [
      makeTrade({ strategy: 'kalshi_yes_poly_no' }),
      makeTrade({ strategy: 'kalshi_yes_poly_no' }),
      makeTrade({ strategy: 'kalshi_no_poly_yes' }),
    ];
    const summary = computeSummary(trades);
    expect(summary.tradesByStrategy['kalshi_yes_poly_no']).toBe(2);
    expect(summary.tradesByStrategy['kalshi_no_poly_yes']).toBe(1);
  });

  it('groups trades by pair', () => {
    const trades = [
      makeTrade({ pairId: 'pair-a' }),
      makeTrade({ pairId: 'pair-a' }),
      makeTrade({ pairId: 'pair-b' }),
      makeTrade({ pairId: 'pair-a' }),
    ];
    const summary = computeSummary(trades);
    expect(summary.tradesByPair['pair-a']).toBe(3);
    expect(summary.tradesByPair['pair-b']).toBe(1);
  });
});
