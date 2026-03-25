import type Database from 'better-sqlite3';
import { analyzeArb, type PairPrices, type ArbThresholds } from '../arb/detector.js';
import { createLogger } from '../logger.js';

const logger = createLogger('backtest');

export interface BacktestConfig {
  thresholds: ArbThresholds;
  /** Only backtest specific pair IDs (null = all) */
  pairIds?: string[];
  /** Start timestamp (ISO string) */
  startDate?: string;
  /** End timestamp (ISO string) */
  endDate?: string;
}

export interface TradeResult {
  pairId: string;
  kalshiTicker: string;
  polymarketId: string;
  strategy: string;
  entryTime: string;
  grossSpreadCents: number;
  estimatedFeesCents: number;
  netSpreadCents: number;
  availableDepthDollars: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  pairsAnalyzed: number;
  snapshotsProcessed: number;
  trades: TradeResult[];
  summary: BacktestSummary;
}

export interface BacktestSummary {
  totalTrades: number;
  totalGrossPnlCents: number;
  totalFeesCents: number;
  totalNetPnlCents: number;
  avgNetSpreadCents: number;
  maxNetSpreadCents: number;
  winRate: number;
  tradesByStrategy: Record<string, number>;
  tradesByPair: Record<string, number>;
}

interface SnapshotRow {
  pair_id: string;
  kalshi_yes_bid: number;
  kalshi_yes_ask: number;
  poly_yes_bid: number;
  poly_yes_ask: number;
  spread_cents: number;
  timestamp: string;
}

interface PairInfoRow {
  kalshi_ticker: string;
  polymarket_id: string;
  kalshi_title: string;
  poly_question: string;
}

/**
 * Run a backtest over historical price snapshots.
 * Replays snapshots through the arb detector and collects hypothetical trades.
 */
export function runBacktest(db: Database.Database, config: BacktestConfig): BacktestResult {
  const startTime = Date.now();

  // Build query for snapshots
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (config.pairIds && config.pairIds.length > 0) {
    conditions.push(`pair_id IN (${config.pairIds.map(() => '?').join(',')})`);
    params.push(...config.pairIds);
  }
  if (config.startDate) {
    conditions.push('timestamp >= ?');
    params.push(config.startDate);
  }
  if (config.endDate) {
    conditions.push('timestamp <= ?');
    params.push(config.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const snapshots = db
    .prepare(`SELECT * FROM price_snapshots ${whereClause} ORDER BY timestamp ASC`)
    .all(...params) as SnapshotRow[];

  // Get pair info for display
  const pairInfoStmt = db.prepare(
    `SELECT mp.kalshi_ticker, mp.polymarket_id,
            km.title as kalshi_title, pm.question as poly_question
     FROM market_pairs mp
     JOIN kalshi_markets km ON mp.kalshi_ticker = km.ticker
     JOIN polymarket_markets pm ON mp.polymarket_id = pm.id
     WHERE mp.id = ?`,
  );

  const pairInfoCache = new Map<string, PairInfoRow>();
  function getPairInfo(pairId: string): PairInfoRow | null {
    if (pairInfoCache.has(pairId)) return pairInfoCache.get(pairId)!;
    const row = pairInfoStmt.get(pairId) as PairInfoRow | undefined;
    if (row) pairInfoCache.set(pairId, row);
    return row ?? null;
  }

  const trades: TradeResult[] = [];
  const pairsAnalyzed = new Set<string>();

  for (const snap of snapshots) {
    pairsAnalyzed.add(snap.pair_id);

    // Skip if we don't have prices from both sides
    if (snap.kalshi_yes_ask === 0 || snap.poly_yes_bid === 0) continue;

    const pairInfo = getPairInfo(snap.pair_id);
    if (!pairInfo) continue;

    const prices: PairPrices = {
      pairId: snap.pair_id,
      kalshiTicker: pairInfo.kalshi_ticker,
      polymarketId: pairInfo.polymarket_id,
      kalshiYesBid: snap.kalshi_yes_bid,
      kalshiYesAsk: snap.kalshi_yes_ask,
      kalshiNoBid: 0, // Not stored in snapshots — derived by detector
      kalshiNoAsk: 0,
      polyYesBid: snap.poly_yes_bid,
      polyYesAsk: snap.poly_yes_ask,
    };

    const analysis = analyzeArb(prices, config.thresholds);

    if (analysis.best) {
      trades.push({
        pairId: snap.pair_id,
        kalshiTicker: pairInfo.kalshi_ticker,
        polymarketId: pairInfo.polymarket_id,
        strategy: analysis.best.strategy,
        entryTime: snap.timestamp,
        grossSpreadCents: analysis.best.bestSpreadCents,
        estimatedFeesCents: analysis.best.estimatedFeesCents,
        netSpreadCents: analysis.best.netSpreadCents,
        availableDepthDollars: analysis.best.availableDepthDollars,
      });
    }
  }

  const summary = computeSummary(trades);
  const elapsed = Date.now() - startTime;

  logger.info(
    `Backtest complete: ${snapshots.length} snapshots, ${pairsAnalyzed.size} pairs, ` +
      `${trades.length} trades in ${elapsed}ms`,
  );

  return {
    config,
    pairsAnalyzed: pairsAnalyzed.size,
    snapshotsProcessed: snapshots.length,
    trades,
    summary,
  };
}

export function computeSummary(trades: TradeResult[]): BacktestSummary {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      totalGrossPnlCents: 0,
      totalFeesCents: 0,
      totalNetPnlCents: 0,
      avgNetSpreadCents: 0,
      maxNetSpreadCents: 0,
      winRate: 0,
      tradesByStrategy: {},
      tradesByPair: {},
    };
  }

  const totalGross = trades.reduce((sum, t) => sum + t.grossSpreadCents, 0);
  const totalFees = trades.reduce((sum, t) => sum + t.estimatedFeesCents, 0);
  const totalNet = trades.reduce((sum, t) => sum + t.netSpreadCents, 0);
  const maxNet = Math.max(...trades.map((t) => t.netSpreadCents));
  const wins = trades.filter((t) => t.netSpreadCents > 0).length;

  const tradesByStrategy: Record<string, number> = {};
  const tradesByPair: Record<string, number> = {};

  for (const t of trades) {
    tradesByStrategy[t.strategy] = (tradesByStrategy[t.strategy] || 0) + 1;
    tradesByPair[t.pairId] = (tradesByPair[t.pairId] || 0) + 1;
  }

  return {
    totalTrades: trades.length,
    totalGrossPnlCents: totalGross,
    totalFeesCents: totalFees,
    totalNetPnlCents: totalNet,
    avgNetSpreadCents: Math.round(totalNet / trades.length),
    maxNetSpreadCents: maxNet,
    winRate: wins / trades.length,
    tradesByStrategy,
    tradesByPair,
  };
}
