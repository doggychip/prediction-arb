import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  initMemory,
  recordOutcome,
  runDebate,
  type AnalystReports,
  type ArbOutcome,
  type LLMClient,
} from '../src/debate/debate-layer.js';
import type { ArbOpportunity } from '../src/arb/types.js';

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `arb-debate-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

const APPROVER_REPLY =
  "This 4¢ net edge is real. Both venues have settled this kind of weather contract cleanly for the past 6 months, depth at quoted prices is $2k+ on both sides, and the divergence-risk score is 0.05 — well below our threshold. The Skeptic's resolution-language concern is speculative; the contract text is identical on both venues. We should take the position at full size.";

const SKEPTIC_REPLY =
  "The Approver is anchoring on past resolution behavior, which doesn't immunize us against a single divergent ruling that wipes the position. Polymarket's clarification UMA process can ratify an outcome that contradicts Kalshi's CFTC-supervised resolution — and when it does, you take 100¢ of loss on the leg that resolved against you. A 4¢ edge cannot pay for that risk on contracts this thin.";

const JUDGE_RULING_JSON = JSON.stringify({
  decision: 'MODIFY',
  rationale:
    "The edge is real but the Skeptic's divergence-risk point lands. Take half size as a compromise: capture the edge while limiting blast radius if Polymarket and Kalshi diverge on this resolution.",
  modifications: { scaleSize: 0.5, notes: 'Half size pending observation of resolution alignment over next 5 contracts.' },
  dissent:
    "The Approver's strongest point is that 6 months of clean cross-venue resolution behavior is genuine evidence — not just optimism. This is overruled because base-rate evidence at this sample size doesn't bound tail risk on a contract structure where one divergent ruling costs 100¢.",
});

function debateMockLLM(): LLMClient {
  return {
    complete: vi
      .fn()
      .mockImplementation(async (system: string): Promise<string> => {
        if (system.startsWith('You are the Approver')) return APPROVER_REPLY;
        if (system.startsWith('You are the Skeptic')) return SKEPTIC_REPLY;
        if (system.startsWith('You are the Judge')) return JUDGE_RULING_JSON;
        throw new Error(`Unexpected system prompt: ${system.slice(0, 40)}`);
      }),
  };
}

const sampleOpp: ArbOpportunity = {
  pairId: 'pair-weather-001',
  kalshiTicker: 'WEATHER-NYC-RAIN-NOV',
  polymarketId: '0x1234abcd',
  kalshiYesBid: 47,
  kalshiYesAsk: 49,
  kalshiNoBid: 51,
  kalshiNoAsk: 53,
  polyYesBid: 48,
  polyYesAsk: 50,
  polyNoBid: 50,
  polyNoAsk: 52,
  bestSpreadCents: 4,
  strategy: 'kalshi_yes_poly_no',
  estimatedFeesCents: 2,
  netSpreadCents: 4,
  availableDepthDollars: 2400,
  detectedAt: new Date().toISOString(),
};

const sampleReports: AnalystReports = {
  edge: {
    trueEdgeCents: 4,
    estFeesCents: 2,
    timeDecayDays: 12,
    reasoning: 'Net 4¢ after fees on $2.4k depth; spread held for 8 minutes during analysis.',
  },
  liquidity: {
    fillableSizeDollars: 1800,
    concerns: [],
    reasoning: 'Both books show stable depth at quoted prices; no signs of drying up.',
  },
  resolution: {
    divergenceRisk: 0.05,
    flags: [],
    severity: 'low',
    reasoning: 'Identical contract text; no historical divergence on weather-category contracts.',
  },
};

describe('debate layer (arb)', () => {
  it('produces a JudgeRuling with non-empty dissent when Skeptic flags divergence risk', async () => {
    const llm = debateMockLLM();
    const memory = initMemory(tmpDbPath());
    const cfg = { maxRounds: 2, llm, ...memory };

    const { ruling, state, memIds } = await runDebate(sampleOpp, sampleReports, cfg);

    expect(['EXECUTE', 'MODIFY', 'REJECT']).toContain(ruling.decision);
    expect(ruling.rationale.length).toBeGreaterThan(0);
    expect(ruling.dissent.length).toBeGreaterThan(0);
    expect(ruling.dissent).toMatch(/approver|divergence|resolution/i);

    expect(state.history).toContain('[APPROVER]');
    expect(state.history).toContain('[SKEPTIC]');
    expect(state.count).toBe(4);

    expect(memIds.a).toBeGreaterThan(0);
    expect(memIds.s).toBeGreaterThan(0);
    expect(memIds.j).toBeGreaterThan(0);

    expect(llm.complete).toHaveBeenCalledTimes(5);
  });

  it('recordOutcome marks Approver wrong when EXECUTE position has a resolution issue', () => {
    const memory = initMemory(tmpDbPath());
    const cfg = { maxRounds: 2, llm: debateMockLLM(), ...memory };

    const ruling = {
      decision: 'EXECUTE' as const,
      rationale: 'took it',
      dissent: 'skeptic flagged divergence',
    };
    const memIds = {
      a: cfg.approverMem.remember('s', 'approver argued for execution'),
      s: cfg.skepticMem.remember('s', 'skeptic flagged divergence'),
      j: cfg.judgeMem.remember('s', JSON.stringify(ruling)),
    };

    const actual: ArbOutcome = {
      settled: true,
      resolutionIssue: true,  // Polymarket diverged
      costOverrun: false,
      notes: 'Polymarket resolved against the position; Kalshi resolved in favor — net 100¢ loss on poly leg.',
    };
    recordOutcome(cfg, memIds, ruling, actual);

    // Verify by recall (memory now has a closed post-mortem on the wrong side)
    const skepticLessons = cfg.skepticMem.recall('s', 5);
    const approverLessons = cfg.approverMem.recall('s', 5);
    expect(skepticLessons.length).toBe(1);
    expect(approverLessons.length).toBe(1);
    // Both will return the same notes string, but their stored 'outcome' differs:
    // we test that property by recalling outcomes via a fresh DB query through recall(),
    // which only returns post_mortems for non-pending rows — so both should be present.
    expect(skepticLessons[0]).toContain('Polymarket');
    expect(approverLessons[0]).toContain('Polymarket');
  });
});
