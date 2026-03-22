import type Database from 'better-sqlite3';
import type { KalshiMarket } from '../kalshi/types.js';
import { kalshiDollarsToCents } from '../kalshi/types.js';
import type { PolymarketMarket } from '../polymarket/types.js';
import type { MarketPair } from '../types.js';
import type { ArbOpportunity } from '../arb/types.js';

// --- Kalshi Markets ---

export function upsertKalshiMarket(db: Database.Database, market: KalshiMarket): void {
  const stmt = db.prepare(`
    INSERT INTO kalshi_markets (
      ticker, event_ticker, title, subtitle, category, status,
      yes_bid, yes_ask, no_bid, no_ask, last_price,
      volume, volume_24h, open_interest, rules_primary,
      close_time, notional_value, updated_at
    ) VALUES (
      @ticker, @event_ticker, @title, @subtitle, @category, @status,
      @yes_bid, @yes_ask, @no_bid, @no_ask, @last_price,
      @volume, @volume_24h, @open_interest, @rules_primary,
      @close_time, @notional_value, datetime('now')
    ) ON CONFLICT(ticker) DO UPDATE SET
      event_ticker = excluded.event_ticker,
      title = excluded.title,
      subtitle = excluded.subtitle,
      category = excluded.category,
      status = excluded.status,
      yes_bid = excluded.yes_bid,
      yes_ask = excluded.yes_ask,
      no_bid = excluded.no_bid,
      no_ask = excluded.no_ask,
      last_price = excluded.last_price,
      volume = excluded.volume,
      volume_24h = excluded.volume_24h,
      open_interest = excluded.open_interest,
      rules_primary = excluded.rules_primary,
      close_time = excluded.close_time,
      notional_value = excluded.notional_value,
      updated_at = datetime('now')
  `);

  stmt.run({
    ticker: market.ticker,
    event_ticker: market.event_ticker,
    title: market.title,
    subtitle: market.subtitle || null,
    category: null, // Not returned by Kalshi API
    status: market.status,
    yes_bid: kalshiDollarsToCents(market.yes_bid_dollars),
    yes_ask: kalshiDollarsToCents(market.yes_ask_dollars),
    no_bid: kalshiDollarsToCents(market.no_bid_dollars),
    no_ask: kalshiDollarsToCents(market.no_ask_dollars),
    last_price: kalshiDollarsToCents(market.last_price_dollars),
    volume: Math.round(parseFloat(market.volume_fp || '0')),
    volume_24h: Math.round(parseFloat(market.volume_24h_fp || '0')),
    open_interest: Math.round(parseFloat(market.open_interest_fp || '0')),
    rules_primary: market.rules_primary || null,
    close_time: market.close_time || null,
    notional_value: kalshiDollarsToCents(market.notional_value_dollars) || 100,
  });
}

export function upsertKalshiMarkets(db: Database.Database, markets: KalshiMarket[]): void {
  const transaction = db.transaction((mkts: KalshiMarket[]) => {
    for (const m of mkts) {
      upsertKalshiMarket(db, m);
    }
  });
  transaction(markets);
}

export function getActiveKalshiMarkets(db: Database.Database): KalshiMarket[] {
  // Note: DB rows have snake_case columns matching KalshiMarket field names
  return db.prepare("SELECT * FROM kalshi_markets WHERE status IN ('open', 'active')").all() as KalshiMarket[];
}

// --- Polymarket Markets ---

export function upsertPolymarketMarket(db: Database.Database, market: PolymarketMarket): void {
  const stmt = db.prepare(`
    INSERT INTO polymarket_markets (
      id, question, condition_id, slug, outcomes, clob_token_ids,
      description, volume, volume_24hr, liquidity,
      active, closed, end_date, tags, neg_risk,
      event_slug, event_title, updated_at
    ) VALUES (
      @id, @question, @condition_id, @slug, @outcomes, @clob_token_ids,
      @description, @volume, @volume_24hr, @liquidity,
      @active, @closed, @end_date, @tags, @neg_risk,
      @event_slug, @event_title, datetime('now')
    ) ON CONFLICT(id) DO UPDATE SET
      question = excluded.question,
      condition_id = excluded.condition_id,
      slug = excluded.slug,
      outcomes = excluded.outcomes,
      clob_token_ids = excluded.clob_token_ids,
      description = excluded.description,
      volume = excluded.volume,
      volume_24hr = excluded.volume_24hr,
      liquidity = excluded.liquidity,
      active = excluded.active,
      closed = excluded.closed,
      end_date = excluded.end_date,
      tags = excluded.tags,
      neg_risk = excluded.neg_risk,
      event_slug = excluded.event_slug,
      event_title = excluded.event_title,
      updated_at = datetime('now')
  `);

  stmt.run({
    id: market.id,
    question: market.question,
    condition_id: market.conditionId || null,
    slug: market.slug || null,
    outcomes: market.outcomes || null,
    clob_token_ids: market.clobTokenIds || null,
    description: market.description || null,
    volume: market.volume || null,
    volume_24hr: market.volume24hr ?? null,
    liquidity: market.liquidity || null,
    active: market.active ? 1 : 0,
    closed: market.closed ? 1 : 0,
    end_date: market.endDate || null,
    tags: market.tags ? JSON.stringify(market.tags) : null,
    neg_risk: market.neg_risk ? 1 : 0,
    event_slug: market.eventSlug || null,
    event_title: market.eventTitle || null,
  });
}

export function upsertPolymarketMarkets(db: Database.Database, markets: PolymarketMarket[]): void {
  const transaction = db.transaction((mkts: PolymarketMarket[]) => {
    for (const m of mkts) {
      upsertPolymarketMarket(db, m);
    }
  });
  transaction(markets);
}

export function getActivePolymarketMarkets(db: Database.Database): PolymarketMarket[] {
  return db.prepare("SELECT * FROM polymarket_markets WHERE active = 1 AND closed = 0").all() as PolymarketMarket[];
}

// --- Market Pairs ---

export interface MarketPairRow {
  id: string;
  kalshi_ticker: string;
  polymarket_id: string;
  match_confidence: number;
  resolution_divergence_risk: number;
  match_method: string;
  status: string;
  notes: string | null;
  kalshi_title: string;
  poly_question: string;
  poly_clob_token_ids: string;
}

export function upsertMarketPair(db: Database.Database, pair: MarketPair): void {
  const stmt = db.prepare(`
    INSERT INTO market_pairs (
      id, kalshi_ticker, polymarket_id, match_confidence,
      resolution_divergence_risk, match_method, status, notes,
      created_at, updated_at
    ) VALUES (
      @id, @kalshi_ticker, @polymarket_id, @match_confidence,
      @resolution_divergence_risk, @match_method, @status, @notes,
      datetime('now'), datetime('now')
    ) ON CONFLICT(id) DO UPDATE SET
      match_confidence = excluded.match_confidence,
      resolution_divergence_risk = excluded.resolution_divergence_risk,
      match_method = excluded.match_method,
      status = excluded.status,
      notes = excluded.notes,
      updated_at = datetime('now')
  `);

  stmt.run({
    id: pair.id,
    kalshi_ticker: pair.kalshiTicker,
    polymarket_id: pair.polymarketId,
    match_confidence: pair.matchConfidence,
    resolution_divergence_risk: pair.resolutionDivergenceRisk,
    match_method: pair.matchMethod,
    status: pair.status,
    notes: pair.notes || null,
  });
}

export function getApprovedPairs(db: Database.Database): MarketPairRow[] {
  return db.prepare(`
    SELECT mp.*, km.title as kalshi_title, pm.question as poly_question,
           pm.clob_token_ids as poly_clob_token_ids
    FROM market_pairs mp
    JOIN kalshi_markets km ON mp.kalshi_ticker = km.ticker
    JOIN polymarket_markets pm ON mp.polymarket_id = pm.id
    WHERE mp.status IN ('approved', 'pending_review')
  `).all() as MarketPairRow[];
}

export function getAllPairs(db: Database.Database): MarketPairRow[] {
  return db.prepare(`
    SELECT mp.*, km.title as kalshi_title, pm.question as poly_question,
           pm.clob_token_ids as poly_clob_token_ids
    FROM market_pairs mp
    JOIN kalshi_markets km ON mp.kalshi_ticker = km.ticker
    JOIN polymarket_markets pm ON mp.polymarket_id = pm.id
  `).all() as MarketPairRow[];
}

// --- Arb Opportunities ---

export function insertArbOpportunity(db: Database.Database, opp: ArbOpportunity): number {
  const stmt = db.prepare(`
    INSERT INTO arb_opportunities (
      pair_id, kalshi_ticker, polymarket_id,
      kalshi_yes_bid, kalshi_yes_ask, kalshi_no_bid, kalshi_no_ask,
      poly_yes_bid, poly_yes_ask, poly_no_bid, poly_no_ask,
      best_spread_cents, strategy, estimated_fees_cents,
      net_spread_cents, available_depth_dollars, detected_at
    ) VALUES (
      @pair_id, @kalshi_ticker, @polymarket_id,
      @kalshi_yes_bid, @kalshi_yes_ask, @kalshi_no_bid, @kalshi_no_ask,
      @poly_yes_bid, @poly_yes_ask, @poly_no_bid, @poly_no_ask,
      @best_spread_cents, @strategy, @estimated_fees_cents,
      @net_spread_cents, @available_depth_dollars, @detected_at
    )
  `);

  const result = stmt.run({
    pair_id: opp.pairId,
    kalshi_ticker: opp.kalshiTicker,
    polymarket_id: opp.polymarketId,
    kalshi_yes_bid: opp.kalshiYesBid,
    kalshi_yes_ask: opp.kalshiYesAsk,
    kalshi_no_bid: opp.kalshiNoBid,
    kalshi_no_ask: opp.kalshiNoAsk,
    poly_yes_bid: opp.polyYesBid,
    poly_yes_ask: opp.polyYesAsk,
    poly_no_bid: opp.polyNoBid,
    poly_no_ask: opp.polyNoAsk,
    best_spread_cents: opp.bestSpreadCents,
    strategy: opp.strategy,
    estimated_fees_cents: opp.estimatedFeesCents,
    net_spread_cents: opp.netSpreadCents,
    available_depth_dollars: opp.availableDepthDollars,
    detected_at: opp.detectedAt,
  });

  return Number(result.lastInsertRowid);
}

export function pruneOldData(
  db: Database.Database,
  snapshotRetentionDays: number,
  arbRetentionDays: number,
): { snapshotsDeleted: number; arbsDeleted: number } {
  const snapshotResult = db.prepare(
    `DELETE FROM price_snapshots WHERE timestamp < datetime('now', '-' || ? || ' days')`,
  ).run(snapshotRetentionDays);

  const arbResult = db.prepare(
    `DELETE FROM arb_opportunities WHERE detected_at < datetime('now', '-' || ? || ' days')`,
  ).run(arbRetentionDays);

  return {
    snapshotsDeleted: snapshotResult.changes,
    arbsDeleted: arbResult.changes,
  };
}

export function getRecentOpportunities(db: Database.Database, limit = 50): any[] {
  return db.prepare(`
    SELECT ao.*, mp.kalshi_ticker, mp.polymarket_id,
           km.title as kalshi_title, pm.question as poly_question
    FROM arb_opportunities ao
    JOIN market_pairs mp ON ao.pair_id = mp.id
    JOIN kalshi_markets km ON ao.kalshi_ticker = km.ticker
    JOIN polymarket_markets pm ON ao.polymarket_id = pm.id
    ORDER BY ao.detected_at DESC
    LIMIT ?
  `).all(limit);
}

// --- Price Snapshots ---

export function insertPriceSnapshot(
  db: Database.Database,
  snapshot: {
    pairId: string;
    kalshiYesBid: number;
    kalshiYesAsk: number;
    polyYesBid: number;
    polyYesAsk: number;
    spreadCents: number;
  },
): void {
  db.prepare(`
    INSERT INTO price_snapshots (
      pair_id, kalshi_yes_bid, kalshi_yes_ask,
      poly_yes_bid, poly_yes_ask, spread_cents
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.pairId,
    snapshot.kalshiYesBid,
    snapshot.kalshiYesAsk,
    snapshot.polyYesBid,
    snapshot.polyYesAsk,
    snapshot.spreadCents,
  );
}
