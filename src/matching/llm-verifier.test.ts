import { describe, it, expect } from 'vitest';
import { buildUserPrompt, parseResponse } from './llm-verifier.js';
import type { MatchCandidate } from './matcher.js';
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

describe('buildUserPrompt', () => {
  it('formats candidates into a numbered list', () => {
    const candidates: MatchCandidate[] = [
      {
        kalshiMarket: makeKalshiMarket('K1', 'Will Bitcoin reach $100k?'),
        polymarketMarket: makePolyMarket('P1', 'Bitcoin to reach $100,000?'),
        confidence: 0.85,
      },
    ];

    const prompt = buildUserPrompt(candidates);
    expect(prompt).toContain('[0]');
    expect(prompt).toContain('Kalshi: "Will Bitcoin reach $100k?"');
    expect(prompt).toContain('Polymarket: "Bitcoin to reach $100,000?"');
    expect(prompt).toContain('Verify these 1 market pair');
  });

  it('includes subtitle and eventTitle when present', () => {
    const candidates: MatchCandidate[] = [
      {
        kalshiMarket: makeKalshiMarket('K1', 'Above 4.5%', 'Fed rate decision'),
        polymarketMarket: makePolyMarket('P1', 'Above 4.5%', 'Federal Reserve'),
        confidence: 0.7,
      },
    ];

    const prompt = buildUserPrompt(candidates);
    expect(prompt).toContain('Above 4.5% (Fed rate decision)');
    expect(prompt).toContain('(Event: Federal Reserve)');
  });

  it('handles multiple candidates', () => {
    const candidates: MatchCandidate[] = [
      {
        kalshiMarket: makeKalshiMarket('K1', 'Market A'),
        polymarketMarket: makePolyMarket('P1', 'Market A poly'),
        confidence: 0.9,
      },
      {
        kalshiMarket: makeKalshiMarket('K2', 'Market B'),
        polymarketMarket: makePolyMarket('P2', 'Market B poly'),
        confidence: 0.8,
      },
    ];

    const prompt = buildUserPrompt(candidates);
    expect(prompt).toContain('[0]');
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('Verify these 2 market pair');
  });
});

describe('parseResponse', () => {
  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      results: [
        {
          index: 0,
          is_match: true,
          confidence: 0.95,
          polarity_inverted: false,
          reasoning: 'Same event, same resolution criteria.',
        },
        {
          index: 1,
          is_match: false,
          confidence: 0.1,
          polarity_inverted: false,
          reasoning: 'Different dates.',
        },
      ],
    });

    const results = parseResponse(raw, 2);
    expect(results.size).toBe(2);

    const r0 = results.get(0)!;
    expect(r0.isMatch).toBe(true);
    expect(r0.confidence).toBe(0.95);
    expect(r0.polarityInverted).toBe(false);
    expect(r0.reasoning).toBe('Same event, same resolution criteria.');

    const r1 = results.get(1)!;
    expect(r1.isMatch).toBe(false);
    expect(r1.confidence).toBe(0.1);
  });

  it('parses JSON wrapped in markdown code blocks', () => {
    const raw =
      '```json\n{"results": [{"index": 0, "is_match": true, "confidence": 0.9, "polarity_inverted": false, "reasoning": "Match"}]}\n```';
    const results = parseResponse(raw, 1);
    expect(results.size).toBe(1);
    expect(results.get(0)!.isMatch).toBe(true);
  });

  it('handles polarity inversion detection', () => {
    const raw = JSON.stringify({
      results: [
        {
          index: 0,
          is_match: true,
          confidence: 0.85,
          polarity_inverted: true,
          reasoning: 'Same event but YES/NO are flipped.',
        },
      ],
    });

    const results = parseResponse(raw, 1);
    expect(results.get(0)!.polarityInverted).toBe(true);
  });

  it('returns empty map for invalid JSON', () => {
    const results = parseResponse('not valid json at all', 1);
    expect(results.size).toBe(0);
  });

  it('returns empty map for malformed schema', () => {
    const raw = JSON.stringify({ wrong_key: 'data' });
    const results = parseResponse(raw, 1);
    expect(results.size).toBe(0);
  });

  it('skips results with out-of-bounds indices', () => {
    const raw = JSON.stringify({
      results: [
        {
          index: 5,
          is_match: true,
          confidence: 0.9,
          polarity_inverted: false,
          reasoning: 'Out of bounds',
        },
      ],
    });

    const results = parseResponse(raw, 2);
    expect(results.size).toBe(0);
  });

  it('handles empty results array', () => {
    const raw = JSON.stringify({ results: [] });
    const results = parseResponse(raw, 5);
    expect(results.size).toBe(0);
  });
});
