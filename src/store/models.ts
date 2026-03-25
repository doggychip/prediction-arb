import type Database from 'better-sqlite3';
import type { PolymarketMarket } from '../polymarket/types.js';
import type { MarketPair } from '../types.js';
import type { ArbOpportunity } from '../arb/types.js';

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

export function getActivePolymarketMarkets(db: Database.Database): any[] {
  return db.prepare("SELECT * FROM polymarket_markets WHERE active = 1 AND closed = 0").all();
}

// --- Market Pairs ---

export function upsertMarketPair(db: Database.Database, pair: MarketPair): void {
  const stmt = db.prepare(`
    INSERT INTO market_pairs (
      id, polymarket_id, match_confidence,
      resolution_divergence_risk, match_method, status, notes,
      created_at, updated_at
    ) VALUES (
      @id, @polymarket_id, @match_confidence,
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
    polymarket_id: pair.polymarketId,
    match_confidence: pair.matchConfidence,
    resolution_divergence_risk: pair.resolutionDivergenceRisk,
    match_method: pair.matchMethod,
    status: pair.status,
    notes: pair.notes || null,
  });
}

export function getApprovedPairs(db: Database.Database): any[] {
  return db.prepare(`
    SELECT mp.*, pm.question as poly_question,
           pm.clob_token_ids as poly_clob_token_ids
    FROM market_pairs mp
    JOIN polymarket_markets pm ON mp.polymarket_id = pm.id
    WHERE mp.status IN ('approved', 'pending_review')
  `).all();
}

export function getAllPairs(db: Database.Database): any[] {
  return db.prepare(`
    SELECT mp.*, pm.question as poly_question,
           pm.clob_token_ids as poly_clob_token_ids
    FROM market_pairs mp
    JOIN polymarket_markets pm ON mp.polymarket_id = pm.id
  `).all();
}

// --- Arb Opportunities ---

export function insertArbOpportunity(db: Database.Database, opp: ArbOpportunity): number {
  const stmt = db.prepare(`
    INSERT INTO arb_opportunities (
      pair_id, polymarket_id,
      poly_yes_bid, poly_yes_ask, poly_no_bid, poly_no_ask,
      best_spread_cents, strategy, estimated_fees_cents,
      net_spread_cents, available_depth_dollars, detected_at
    ) VALUES (
      @pair_id, @polymarket_id,
      @poly_yes_bid, @poly_yes_ask, @poly_no_bid, @poly_no_ask,
      @best_spread_cents, @strategy, @estimated_fees_cents,
      @net_spread_cents, @available_depth_dollars, @detected_at
    )
  `);

  const result = stmt.run({
    pair_id: opp.pairId,
    polymarket_id: opp.polymarketId,
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

export function getRecentOpportunities(db: Database.Database, limit = 50): any[] {
  return db.prepare(`
    SELECT ao.*, mp.polymarket_id,
           pm.question as poly_question
    FROM arb_opportunities ao
    JOIN market_pairs mp ON ao.pair_id = mp.id
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
    polyYesBid: number;
    polyYesAsk: number;
    spreadCents: number;
  },
): void {
  db.prepare(`
    INSERT INTO price_snapshots (
      pair_id, poly_yes_bid, poly_yes_ask, spread_cents
    ) VALUES (?, ?, ?, ?)
  `).run(
    snapshot.pairId,
    snapshot.polyYesBid,
    snapshot.polyYesAsk,
    snapshot.spreadCents,
  );
}
