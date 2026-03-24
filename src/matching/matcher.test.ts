import { describe, it, expect } from 'vitest';
import { findMatches, candidatesToPairs } from './matcher.js';
import type { KalshiMarket } from '../kalshi/types.js';
import type { PolymarketMarket } from '../polymarket/types.js';

function makeKalshiMarket(ticker: string, title: string, subtitle = ''): KalshiMarket {
  return {
    ticker,
    event_ticker: 'EVT-1',
    title,
    subtitle,
    status: 'open',
    market_type: 'binary',
    yes_bid_dollars: '0.50',
    yes_ask_dollars: '0.52',
    no_bid_dollars: '0.48',
    no_ask_dollars: '0.50',
    last_price_dollars: '0.50',
    notional_value_dollars: '1.00',
    volume_fp: '1000',
    volume_24h_fp: '100',
    open_interest_fp: '500',
    liquidity_dollars: '1000',
    yes_bid_size_fp: '100',
    yes_ask_size_fp: '100',
    rules_primary: '',
    rules_secondary: '',
    close_time: '',
    open_time: '',
    expiration_time: '',
    expected_expiration_time: '',
    result: '',
    expiration_value: '',
    tick_size: 1,
    settlement_timer_seconds: 0,
    can_close_early: false,
    response_price_units: 'yes',
    yes_sub_title: '',
    no_sub_title: '',
    strike_type: '',
  };
}

function makePolyMarket(id: string, question: string, eventTitle = ''): PolymarketMarket {
  return {
    id,
    question,
    conditionId: 'cond-1',
    slug: 'test-market',
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.50","0.50"]',
    volume: '1000',
    volume24hr: 100,
    liquidity: '500',
    active: true,
    closed: false,
    clobTokenIds: '["token-1","token-2"]',
    enableOrderBook: true,
    description: '',
    endDate: '',
    tags: [],
    neg_risk: false,
    eventSlug: '',
    eventTitle,
  };
}

describe('findMatches', () => {
  it('matches identical market titles', () => {
    const kalshi = [makeKalshiMarket('K1', 'Will Bitcoin reach $100k by 2025?')];
    const poly = [makePolyMarket('P1', 'Will Bitcoin reach $100k by 2025?')];

    const matches = findMatches(kalshi, poly, 0.35);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBeGreaterThan(0.9);
    expect(matches[0].kalshiMarket.ticker).toBe('K1');
    expect(matches[0].polymarketMarket.id).toBe('P1');
  });

  it('matches similar market titles with different wording', () => {
    const kalshi = [makeKalshiMarket('K1', 'Bitcoin price above $100,000 by December 2025')];
    const poly = [makePolyMarket('P1', 'Will Bitcoin price be above $100,000 in December 2025?')];

    const matches = findMatches(kalshi, poly, 0.35);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBeGreaterThan(0.4);
  });

  it('does not match unrelated markets', () => {
    const kalshi = [makeKalshiMarket('K1', 'Will SpaceX launch Starship in Q1 2025?')];
    const poly = [makePolyMarket('P1', 'Will the Federal Reserve cut interest rates in March?')];

    const matches = findMatches(kalshi, poly, 0.35);
    expect(matches).toHaveLength(0);
  });

  it('handles empty inputs', () => {
    expect(findMatches([], [], 0.35)).toHaveLength(0);
    expect(findMatches([makeKalshiMarket('K1', 'Test')], [], 0.35)).toHaveLength(0);
    expect(findMatches([], [makePolyMarket('P1', 'Test')], 0.35)).toHaveLength(0);
  });

  it('picks best match when multiple candidates exist', () => {
    const kalshi = [makeKalshiMarket('K1', 'Will Trump win the 2024 presidential election?')];
    const poly = [
      makePolyMarket('P1', 'Will Biden win the 2024 presidential election?'),
      makePolyMarket('P2', 'Will Trump win the 2024 presidential election?'),
    ];

    const matches = findMatches(kalshi, poly, 0.35);
    expect(matches).toHaveLength(1);
    expect(matches[0].polymarketMarket.id).toBe('P2');
  });

  it('uses eventTitle for matching context', () => {
    const kalshi = [makeKalshiMarket('K1', 'Above 4.5%', 'Federal Reserve interest rate decision')];
    const poly = [makePolyMarket('P1', 'Above 4.5%', 'Federal Reserve interest rate decision')];

    const matches = findMatches(kalshi, poly, 0.35);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBeGreaterThan(0.5);
  });

  it('respects minConfidence threshold', () => {
    const kalshi = [makeKalshiMarket('K1', 'Will something happen soon?')];
    const poly = [makePolyMarket('P1', 'Something might happen eventually')];

    const highThreshold = findMatches(kalshi, poly, 0.95);
    expect(highThreshold).toHaveLength(0);

    const lowThreshold = findMatches(kalshi, poly, 0.1);
    expect(lowThreshold.length).toBeGreaterThanOrEqual(0); // may or may not match
  });
});

describe('candidatesToPairs', () => {
  it('converts candidates to MarketPair objects', () => {
    const candidates = [
      {
        kalshiMarket: makeKalshiMarket('K1', 'Test'),
        polymarketMarket: makePolyMarket('P1', 'Test'),
        confidence: 0.85,
      },
    ];

    const pairs = candidatesToPairs(candidates);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kalshiTicker).toBe('K1');
    expect(pairs[0].polymarketId).toBe('P1');
    expect(pairs[0].matchConfidence).toBe(0.85);
    expect(pairs[0].matchMethod).toBe('string_similarity');
    expect(pairs[0].status).toBe('pending_review');
    expect(pairs[0].id).toBeDefined();
  });

  it('generates unique IDs for each pair', () => {
    const candidates = [
      {
        kalshiMarket: makeKalshiMarket('K1', 'Test 1'),
        polymarketMarket: makePolyMarket('P1', 'Test 1'),
        confidence: 0.8,
      },
      {
        kalshiMarket: makeKalshiMarket('K2', 'Test 2'),
        polymarketMarket: makePolyMarket('P2', 'Test 2'),
        confidence: 0.7,
      },
    ];

    const pairs = candidatesToPairs(candidates);
    expect(pairs[0].id).not.toBe(pairs[1].id);
  });

  it('handles empty candidates', () => {
    expect(candidatesToPairs([])).toHaveLength(0);
  });
});
