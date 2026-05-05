/**
 * prediction-arb: Debate Layer
 * -----------------------------
 * Adversarial reasoning over detected ArbOpportunity instances.
 * Adapted from the zhihuiti-payments debate layer; same pattern,
 * different domain.
 *
 *   Layer 1: Edge / Liquidity / Resolution analysts (data gathering)
 *   Layer 2: Approver vs Skeptic debate (counter-pointing required)
 *   Layer 3: Judge — forced commitment to BET / SCALE / SKIP
 *
 * Asymmetric per-role memory closes the loop on market resolution.
 */

import Database from 'better-sqlite3';
import type { ArbOpportunity, ArbStrategy } from '../arb/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Layer 1 outputs — produced by the three analysts before debate. */
export interface AnalystReports {
  edge: {
    trueEdgeCents: number;        // realistic edge after slippage + fees + time decay
    estFeesCents: number;         // total fees both legs
    timeDecayDays: number;        // days until resolution
    reasoning: string;
  };
  liquidity: {
    fillableSizeDollars: number;  // realistic fillable size at quoted prices
    concerns: string[];           // e.g. ['thin_kalshi_book', 'polymarket_drying_up']
    reasoning: string;
  };
  resolution: {
    divergenceRisk: number;       // 0-1 probability of cross-venue disagreement
    flags: string[];              // e.g. ['ambiguous_resolution', 'kalshi_delisting_risk']
    severity: 'low' | 'med' | 'high';
    reasoning: string;
  };
}

export interface DebateState {
  history: string;
  approverHistory: string;
  skepticHistory: string;
  currentResponse: string;
  count: number;
}

/**
 * Decision semantics for arb:
 *   EXECUTE → take the full position
 *   MODIFY  → take a smaller / scaled position (e.g. 50% size)
 *   REJECT  → skip
 */
export type Decision = 'EXECUTE' | 'MODIFY' | 'REJECT';

export interface JudgeRuling {
  decision: Decision;
  rationale: string;
  /** Only when MODIFY: scale factor (0.0-1.0) and any other adjustments. */
  modifications?: {
    scaleSize?: number;
    notes?: string;
  };
  /** Strongest point from the losing side. Non-negotiable. */
  dissent: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory: separate stores per role (the critical asymmetry)
// ─────────────────────────────────────────────────────────────────────────────

export class RoleMemory {
  private db: Database.Database;
  constructor(dbPath: string, private role: 'approver' | 'skeptic' | 'judge') {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_${role} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        situation_hash TEXT,
        situation_summary TEXT,
        argument TEXT,
        outcome TEXT,            -- 'correct' | 'wrong' | 'pending'
        post_mortem TEXT,
        ts INTEGER
      )`);
  }

  recall(_situation: string, n = 2): string[] {
    const rows = this.db
      .prepare(
        `SELECT post_mortem FROM memory_${this.role}
         WHERE outcome != 'pending' AND post_mortem IS NOT NULL
         ORDER BY ts DESC LIMIT ?`,
      )
      .all(n) as { post_mortem: string }[];
    return rows.map((r) => r.post_mortem);
  }

  remember(situation: string, argument: string): number {
    const stmt = this.db.prepare(
      `INSERT INTO memory_${this.role}
       (situation_hash, situation_summary, argument, outcome, ts)
       VALUES (?, ?, ?, 'pending', ?)`,
    );
    return stmt.run(hash(situation), situation, argument, Date.now()).lastInsertRowid as number;
  }

  postMortem(memId: number, outcome: 'correct' | 'wrong', lesson: string): void {
    this.db
      .prepare(`UPDATE memory_${this.role} SET outcome = ?, post_mortem = ? WHERE id = ?`)
      .run(outcome, lesson, memId);
  }
}

export interface MemoryStores {
  approverMem: RoleMemory;
  skepticMem: RoleMemory;
  judgeMem: RoleMemory;
}

export function initMemory(dbPath: string): MemoryStores {
  return {
    approverMem: new RoleMemory(dbPath, 'approver'),
    skepticMem: new RoleMemory(dbPath, 'skeptic'),
    judgeMem: new RoleMemory(dbPath, 'judge'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM client interface
// ─────────────────────────────────────────────────────────────────────────────

export interface LLMClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2: Approver (bull) and Skeptic (bear)
// ─────────────────────────────────────────────────────────────────────────────

const APPROVER_SYSTEM = `You are the Approver in a prediction-market arbitrage debate.
Your job is to advocate for taking the proposed arb position. Cite the realistic
edge after fees and slippage, market liquidity, time-to-resolution efficiency,
and venue reliability for this kind of contract. You MUST specifically refute
the LAST argument made by the Skeptic — engage their concern directly, do not
restate your case. Never default to "let's wait" or "let's research more".
Argue for the trade.`;

const SKEPTIC_SYSTEM = `You are the Skeptic in a prediction-market arbitrage debate.
Your job is to expose why the apparent edge isn't real or isn't capturable:
cross-venue resolution divergence risk, thin liquidity that won't fill at quoted
prices, regulatory risk (Kalshi delisting, Polymarket ToS conflicts), stale
prices, ambiguous resolution criteria, time-decay drag. You MUST specifically
refute the LAST argument made by the Approver — find the over-optimistic
assumption in their case and break it. Do not just restate concerns.`;

async function approverTurn(
  llm: LLMClient,
  opp: ArbOpportunity,
  reports: AnalystReports,
  state: DebateState,
  memory: RoleMemory,
): Promise<DebateState> {
  const lessons = memory.recall(situationKey(opp, reports), 2);
  const prompt = buildDebatePrompt({
    role: 'approver',
    opp,
    reports,
    state,
    lessons,
    lastOpponent: state.currentResponse,
  });
  const argument = await llm.complete(APPROVER_SYSTEM, prompt);
  return {
    history: state.history + '\n\n[APPROVER] ' + argument,
    approverHistory: state.approverHistory + '\n' + argument,
    skepticHistory: state.skepticHistory,
    currentResponse: argument,
    count: state.count + 1,
  };
}

async function skepticTurn(
  llm: LLMClient,
  opp: ArbOpportunity,
  reports: AnalystReports,
  state: DebateState,
  memory: RoleMemory,
): Promise<DebateState> {
  const lessons = memory.recall(situationKey(opp, reports), 2);
  const prompt = buildDebatePrompt({
    role: 'skeptic',
    opp,
    reports,
    state,
    lessons,
    lastOpponent: state.currentResponse,
  });
  const argument = await llm.complete(SKEPTIC_SYSTEM, prompt);
  return {
    history: state.history + '\n\n[SKEPTIC] ' + argument,
    approverHistory: state.approverHistory,
    skepticHistory: state.skepticHistory + '\n' + argument,
    currentResponse: argument,
    count: state.count + 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3: Judge — forced commitment
// ─────────────────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are the Judge in a prediction-market arbitrage debate.
You have read the full transcript between the Approver and the Skeptic.

You MUST commit to one of: EXECUTE, MODIFY, REJECT.
  EXECUTE → take the full position as detected.
  MODIFY  → take a scaled position (specify scaleSize 0.0-1.0).
  REJECT  → skip.

You are FORBIDDEN from saying "needs human review" or "insufficient information"
unless one of the analyst reports is literally missing. Pick the strongest side
based on the arguments made. Surface the dissent: in the JSON, name the strongest
point the losing side made and explain why it didn't carry the day.

Output JSON only:
{ "decision": "EXECUTE"|"MODIFY"|"REJECT",
  "rationale": "...",
  "modifications": { "scaleSize": 0.5, "notes": "..." },   // only if MODIFY
  "dissent": "..." }`;

async function judgeRule(
  llm: LLMClient,
  opp: ArbOpportunity,
  reports: AnalystReports,
  state: DebateState,
  memory: RoleMemory,
): Promise<JudgeRuling> {
  const lessons = memory.recall(situationKey(opp, reports), 3);
  const prompt = `
ARB OPPORTUNITY:
${JSON.stringify(opp, null, 2)}

ANALYST REPORTS:
${JSON.stringify(reports, null, 2)}

DEBATE TRANSCRIPT:
${state.history}

YOUR PAST LESSONS (judge memory):
${lessons.length ? lessons.map((l, i) => `${i + 1}. ${l}`).join('\n') : '(none yet)'}

Rule now. Output JSON only.`;
  const raw = await llm.complete(JUDGE_SYSTEM, prompt);
  return JSON.parse(stripFences(raw)) as JudgeRuling;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export interface DebateConfig {
  maxRounds: number;
  llm: LLMClient;
  approverMem: RoleMemory;
  skepticMem: RoleMemory;
  judgeMem: RoleMemory;
}

export async function runDebate(
  opp: ArbOpportunity,
  reports: AnalystReports,
  cfg: DebateConfig,
): Promise<{ ruling: JudgeRuling; state: DebateState; memIds: { a: number; s: number; j: number } }> {
  let state: DebateState = {
    history: '',
    approverHistory: '',
    skepticHistory: '',
    currentResponse: '',
    count: 0,
  };

  const totalTurns = cfg.maxRounds * 2;
  for (let i = 0; i < totalTurns; i++) {
    state = i % 2 === 0
      ? await approverTurn(cfg.llm, opp, reports, state, cfg.approverMem)
      : await skepticTurn(cfg.llm, opp, reports, state, cfg.skepticMem);
  }

  const ruling = await judgeRule(cfg.llm, opp, reports, state, cfg.judgeMem);

  const sit = situationKey(opp, reports);
  const memIds = {
    a: cfg.approverMem.remember(sit, state.approverHistory),
    s: cfg.skepticMem.remember(sit, state.skepticHistory),
    j: cfg.judgeMem.remember(sit, JSON.stringify(ruling)),
  };

  return { ruling, state, memIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement feedback — call this when the underlying market resolves
// ─────────────────────────────────────────────────────────────────────────────

export interface ArbOutcome {
  /** Position closed cleanly (no platform issues, both legs settled). */
  settled: boolean;
  /** Kalshi delisted / Polymarket flagged / one venue refused to honor resolution. */
  resolutionIssue: boolean;
  /** Actual fill cost was materially worse than estimate (slippage / fees). */
  costOverrun: boolean;
  notes: string;
}

export function recordOutcome(
  cfg: DebateConfig,
  memIds: { a: number; s: number; j: number },
  ruling: JudgeRuling,
  actual: ArbOutcome,
): void {
  // Approver was right if EXECUTE happened and it settled cleanly with no resolution issue.
  const approverCorrect =
    ruling.decision === 'EXECUTE' && actual.settled && !actual.resolutionIssue;
  // Skeptic was right if we skipped/scaled OR if EXECUTE blew up.
  const skepticCorrect =
    ruling.decision !== 'EXECUTE' || actual.resolutionIssue || actual.costOverrun;
  const judgeCorrect = approverCorrect || skepticCorrect;

  cfg.approverMem.postMortem(memIds.a, approverCorrect ? 'correct' : 'wrong', actual.notes);
  cfg.skepticMem.postMortem(memIds.s, skepticCorrect ? 'correct' : 'wrong', actual.notes);
  cfg.judgeMem.postMortem(memIds.j, judgeCorrect ? 'correct' : 'wrong', actual.notes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildDebatePrompt(args: {
  role: 'approver' | 'skeptic';
  opp: ArbOpportunity;
  reports: AnalystReports;
  state: DebateState;
  lessons: string[];
  lastOpponent: string;
}): string {
  return `
ARB OPPORTUNITY:
${JSON.stringify(args.opp, null, 2)}

ANALYST REPORTS:
- Edge: ${args.reports.edge.reasoning} (true edge ≈ ${args.reports.edge.trueEdgeCents}¢, ${args.reports.edge.timeDecayDays}d to resolution)
- Liquidity: ${args.reports.liquidity.reasoning} (fillable ≈ $${args.reports.liquidity.fillableSizeDollars}; concerns: ${args.reports.liquidity.concerns.join(', ') || 'none'})
- Resolution: ${args.reports.resolution.reasoning} (divergence risk ${args.reports.resolution.divergenceRisk}, severity ${args.reports.resolution.severity}, flags: ${args.reports.resolution.flags.join(', ') || 'none'})

DEBATE SO FAR:
${args.state.history || '(this is the opening argument)'}

OPPONENT'S LAST ARGUMENT (refute this directly):
${args.lastOpponent || '(no opponent argument yet — make your opening case)'}

YOUR PAST LESSONS:
${args.lessons.length ? args.lessons.map((l, i) => `${i + 1}. ${l}`).join('\n') : '(none yet)'}

Make your argument now (3-5 sentences, sharp, specific).`;
}

function situationKey(opp: ArbOpportunity, reports: AnalystReports): string {
  const eventPrefix = opp.kalshiTicker.split('-')[0];
  return `${eventPrefix}|${opp.strategy as ArbStrategy}|${reports.resolution.severity}`;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h.toString(16);
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}
