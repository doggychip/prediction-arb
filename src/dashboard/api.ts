import type http from 'http';
import type Database from 'better-sqlite3';
import { createLogger } from '../logger.js';

const logger = createLogger('dashboard-api');

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function handleApiRequest(
  url: URL,
  db: Database.Database,
  getStats: () => { oppsFound: number; alertsSent: number; suppressed: number; cacheSize: number },
  res: http.ServerResponse,
): void {
  try {
    const path = url.pathname;

    // GET /api/stats — live engine stats
    if (path === '/api/stats') {
      const stats = getStats();
      const pairCount = db
        .prepare(
          "SELECT COUNT(*) as count FROM market_pairs WHERE status IN ('approved', 'pending_review')",
        )
        .get() as { count: number };
      json(res, { ...stats, pairs: pairCount.count, uptime: process.uptime() });
      return;
    }

    // GET /api/pairs — all tracked market pairs
    if (path === '/api/pairs') {
      const rows = db
        .prepare(
          `SELECT mp.id, mp.kalshi_ticker, mp.polymarket_id, mp.match_confidence,
                  mp.resolution_divergence_risk, mp.match_method, mp.status, mp.notes,
                  km.title as kalshi_title, pm.question as poly_question,
                  km.yes_bid as kalshi_yes_bid, km.yes_ask as kalshi_yes_ask,
                  km.no_bid as kalshi_no_bid, km.no_ask as kalshi_no_ask,
                  pm.volume_24hr as poly_volume_24hr, pm.liquidity as poly_liquidity
           FROM market_pairs mp
           JOIN kalshi_markets km ON mp.kalshi_ticker = km.ticker
           JOIN polymarket_markets pm ON mp.polymarket_id = pm.id
           ORDER BY mp.match_confidence DESC`,
        )
        .all();
      json(res, rows);
      return;
    }

    // GET /api/opportunities?limit=N — recent arb opportunities
    if (path === '/api/opportunities') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const rows = db
        .prepare(
          `SELECT ao.*, km.title as kalshi_title, pm.question as poly_question
           FROM arb_opportunities ao
           JOIN kalshi_markets km ON ao.kalshi_ticker = km.ticker
           JOIN polymarket_markets pm ON ao.polymarket_id = pm.id
           ORDER BY ao.detected_at DESC
           LIMIT ?`,
        )
        .all(Math.min(limit, 500));
      json(res, rows);
      return;
    }

    // GET /api/snapshots?pair_id=X&limit=N — price history for a pair
    if (path === '/api/snapshots') {
      const pairId = url.searchParams.get('pair_id');
      const limit = parseInt(url.searchParams.get('limit') || '200', 10);
      if (!pairId) {
        json(res, { error: 'pair_id parameter required' }, 400);
        return;
      }
      const rows = db
        .prepare(
          `SELECT * FROM price_snapshots
           WHERE pair_id = ?
           ORDER BY timestamp DESC
           LIMIT ?`,
        )
        .all(pairId, Math.min(limit, 2000));
      json(res, rows);
      return;
    }

    // GET /api/summary — aggregate stats
    if (path === '/api/summary') {
      const oppsByDay = db
        .prepare(
          `SELECT date(detected_at) as day, COUNT(*) as count,
                  AVG(net_spread_cents) as avg_spread, MAX(net_spread_cents) as max_spread
           FROM arb_opportunities
           GROUP BY date(detected_at)
           ORDER BY day DESC
           LIMIT 30`,
        )
        .all();
      const topPairs = db
        .prepare(
          `SELECT pair_id, kalshi_ticker, polymarket_id,
                  COUNT(*) as opp_count, AVG(net_spread_cents) as avg_spread
           FROM arb_opportunities
           GROUP BY pair_id
           ORDER BY opp_count DESC
           LIMIT 10`,
        )
        .all();
      json(res, { oppsByDay, topPairs });
      return;
    }

    json(res, { error: 'Unknown API endpoint' }, 404);
  } catch (err) {
    logger.error('API error', { error: (err as Error).message });
    json(res, { error: 'Internal server error' }, 500);
  }
}
