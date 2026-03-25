import { describe, it, expect } from 'vitest';
import { formatAlertText } from './notifier.js';
import type { ArbOpportunity } from '../arb/types.js';

function makeOpp(): ArbOpportunity {
  return {
    pairId: 'pair-1',
    kalshiTicker: 'K-BTC-100K',
    polymarketId: 'poly-btc-100k',
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
  };
}

describe('formatAlertText', () => {
  it('formats alert text with all fields', () => {
    const text = formatAlertText(makeOpp(), 'Bitcoin $100k', 'Will BTC reach $100k?');
    expect(text).toContain('Arb Opportunity Detected');
    expect(text).toContain('Bitcoin $100k');
    expect(text).toContain('Will BTC reach $100k?');
    expect(text).toContain('Buy YES on Kalshi');
    expect(text).toContain('gross 10');
    expect(text).toContain('net 7');
    expect(text).toContain('$500');
  });

  it('falls back to ticker when title not provided', () => {
    const text = formatAlertText(makeOpp());
    expect(text).toContain('K-BTC-100K');
    expect(text).toContain('poly-btc-100k');
  });

  it('formats kalshi_no_poly_yes strategy', () => {
    const opp = makeOpp();
    opp.strategy = 'kalshi_no_poly_yes';
    const text = formatAlertText(opp);
    expect(text).toContain('Buy NO on Kalshi');
  });

  it('shows Unknown depth when 0', () => {
    const opp = makeOpp();
    opp.availableDepthDollars = 0;
    const text = formatAlertText(opp);
    expect(text).toContain('Unknown');
  });
});
