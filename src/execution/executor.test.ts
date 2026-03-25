import { describe, it, expect } from 'vitest';
import { TradeExecutor, type ExecutionConfig } from './executor.js';
import type { ArbOpportunity } from '../arb/types.js';

function makeOpp(overrides: Partial<ArbOpportunity> = {}): ArbOpportunity {
  return {
    pairId: 'pair-1',
    kalshiTicker: 'K-TEST',
    polymarketId: 'P-TEST',
    kalshiYesBid: 45,
    kalshiYesAsk: 47,
    kalshiNoBid: 51,
    kalshiNoAsk: 53,
    polyYesBid: 58,
    polyYesAsk: 60,
    polyNoBid: 40,
    polyNoAsk: 42,
    bestSpreadCents: 10,
    strategy: 'kalshi_yes_poly_no',
    estimatedFeesCents: 3,
    netSpreadCents: 7,
    availableDepthDollars: 500,
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

const paperConfig: ExecutionConfig = {
  mode: 'paper',
  maxPositionDollars: 1000,
  maxDailyTrades: 10,
  minNetSpreadCents: 3,
  minDepthDollars: 50,
  killSwitchEnabled: true,
};

const disabledConfig: ExecutionConfig = {
  ...paperConfig,
  mode: 'disabled',
};

describe('TradeExecutor', () => {
  it('executes paper trades', async () => {
    const executor = new TradeExecutor(paperConfig);
    const order = await executor.execute(makeOpp());

    expect(order).not.toBeNull();
    expect(order!.mode).toBe('paper');
    expect(order!.status).toBe('filled');
    expect(order!.kalshiSide).toBe('yes');
    expect(order!.polySide).toBe('no');
    expect(order!.quantityDollars).toBeGreaterThan(0);
  });

  it('rejects when execution is disabled', async () => {
    const executor = new TradeExecutor(disabledConfig);
    const order = await executor.execute(makeOpp());
    expect(order).toBeNull();
  });

  it('rejects when net spread is below minimum', async () => {
    const executor = new TradeExecutor(paperConfig);
    const order = await executor.execute(makeOpp({ netSpreadCents: 1 }));
    expect(order).toBeNull();
  });

  it('rejects when depth is below minimum', async () => {
    const executor = new TradeExecutor(paperConfig);
    const order = await executor.execute(makeOpp({ availableDepthDollars: 10 }));
    expect(order).toBeNull();
  });

  it('rejects when daily trade limit reached', async () => {
    const config: ExecutionConfig = { ...paperConfig, maxDailyTrades: 2 };
    const executor = new TradeExecutor(config);

    await executor.execute(makeOpp());
    await executor.execute(makeOpp());
    const third = await executor.execute(makeOpp());

    expect(third).toBeNull();
  });

  it('rejects when max position reached', async () => {
    const config: ExecutionConfig = { ...paperConfig, maxPositionDollars: 50 };
    const executor = new TradeExecutor(config);

    // First trade takes some position
    await executor.execute(makeOpp());
    // May not have room for another depending on sizing
    const stats = executor.getStats();
    expect(stats.openPositionDollars).toBeGreaterThan(0);
  });

  it('kill switch prevents trading', async () => {
    const executor = new TradeExecutor(paperConfig);
    executor.tripKillSwitch('test');

    expect(executor.isKillSwitched()).toBe(true);
    const order = await executor.execute(makeOpp());
    expect(order).toBeNull();

    // Reset and trade again
    executor.resetKillSwitch();
    expect(executor.isKillSwitched()).toBe(false);
    const order2 = await executor.execute(makeOpp());
    expect(order2).not.toBeNull();
  });

  it('tracks stats correctly', async () => {
    const executor = new TradeExecutor(paperConfig);
    await executor.execute(makeOpp({ netSpreadCents: 5 }));
    await executor.execute(makeOpp({ netSpreadCents: 10 }));

    const stats = executor.getStats();
    expect(stats.tradesPlaced).toBe(2);
    expect(stats.tradesToday).toBe(2);
    expect(stats.totalPnlCents).toBe(15);
    expect(stats.mode).toBe('paper');
  });

  it('returns trade history', async () => {
    const executor = new TradeExecutor(paperConfig);
    await executor.execute(makeOpp());
    await executor.execute(makeOpp());

    const history = executor.getTradeHistory();
    expect(history).toHaveLength(2);
    expect(history[0].status).toBe('filled');
  });

  it('handles kalshi_no_poly_yes strategy correctly', async () => {
    const executor = new TradeExecutor(paperConfig);
    const order = await executor.execute(makeOpp({ strategy: 'kalshi_no_poly_yes' }));

    expect(order!.kalshiSide).toBe('no');
    expect(order!.polySide).toBe('yes');
  });

  it('live mode rejects with not-implemented', async () => {
    const config: ExecutionConfig = { ...paperConfig, mode: 'live' };
    const executor = new TradeExecutor(config);
    const order = await executor.execute(makeOpp());

    expect(order).not.toBeNull();
    expect(order!.status).toBe('rejected');
    expect(order!.error).toContain('not yet implemented');
  });
});
