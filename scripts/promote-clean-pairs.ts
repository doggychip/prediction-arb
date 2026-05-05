/**
 * promote-clean-pairs.ts
 *
 * One-time DB cleanup tied to PLAN step 2.5:
 *   1. Loads every market_pair with its kalshi event_ticker.
 *   2. Detects multi-candidate-collision pairs via shared detectCollisions
 *      (same polymarket_id + same kalshi event_ticker, 2+ kalshi tickers).
 *   3. Hard-deletes collision pairs. Schema declares REFERENCES without
 *      ON DELETE CASCADE, so we explicitly delete dependent rows in
 *      dependency order (arb_opportunities, price_snapshots) before
 *      deleting the pair, all in one transaction.
 *   4. Marks remaining pairs as 'approved'.
 *
 * Default mode is DRY-RUN (no writes). Pass --apply to commit.
 *
 * Usage:
 *   tsx scripts/promote-clean-pairs.ts            # dry-run
 *   tsx scripts/promote-clean-pairs.ts --apply    # commit changes
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { detectCollisions } from '../src/matching/matcher.js';
import { createLogger } from '../src/logger.js';

const logger = createLogger('promote-clean-pairs');

const DB_PATH = process.env.DB_PATH ?? 'data/arb.db';
const APPLY = process.argv.includes('--apply');

interface PairRow {
  id: string;
  kalshi_ticker: string;
  event_ticker: string;
  polymarket_id: string;
  status: string;
}

function main(): void {
  logger.info(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (no writes)'}`);
  logger.info(`DB: ${DB_PATH}`);

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  const pairs = db
    .prepare(
      `SELECT mp.id, mp.kalshi_ticker, km.event_ticker, mp.polymarket_id, mp.status
       FROM market_pairs mp
       JOIN kalshi_markets km ON mp.kalshi_ticker = km.ticker`,
    )
    .all() as PairRow[];

  logger.info(`Loaded ${pairs.length} pairs`);

  const statusBefore: Record<string, number> = {};
  for (const p of pairs) statusBefore[p.status] = (statusBefore[p.status] ?? 0) + 1;
  logger.info(`Status before: ${JSON.stringify(statusBefore)}`);

  const { collisionGroups, droppedPairKeys } = detectCollisions(
    pairs.map((p) => ({
      kalshiTicker: p.kalshi_ticker,
      kalshiEventTicker: p.event_ticker,
      polymarketId: p.polymarket_id,
    })),
  );

  const dropPairs = pairs.filter((p) =>
    droppedPairKeys.has(`${p.kalshi_ticker}::${p.polymarket_id}`),
  );
  const keepPairs = pairs.filter(
    (p) => !droppedPairKeys.has(`${p.kalshi_ticker}::${p.polymarket_id}`),
  );

  logger.info(`Collision groups detected: ${collisionGroups.length}`);
  for (const g of collisionGroups) {
    logger.info(
      `  polymarket=${g.polymarketId} event=${g.eventTicker} kalshi_tickers=[${g.kalshiTickers.join(', ')}]`,
    );
  }

  // Cascade impact: how many dependent rows would be deleted
  if (dropPairs.length > 0) {
    const placeholders = dropPairs.map(() => '?').join(',');
    const dropIds = dropPairs.map((p) => p.id);
    const oppCount = db
      .prepare(`SELECT COUNT(*) AS c FROM arb_opportunities WHERE pair_id IN (${placeholders})`)
      .get(...dropIds) as { c: number };
    const snapCount = db
      .prepare(`SELECT COUNT(*) AS c FROM price_snapshots WHERE pair_id IN (${placeholders})`)
      .get(...dropIds) as { c: number };
    logger.info(
      `Cascade impact: ${oppCount.c} arb_opportunities + ${snapCount.c} price_snapshots will be deleted`,
    );
  }

  logger.info(`Pairs to DROP: ${dropPairs.length}`);
  logger.info(`Pairs to MARK approved: ${keepPairs.length}`);

  if (!APPLY) {
    logger.info('Dry-run complete. No changes written. Pass --apply to commit.');
    db.close();
    return;
  }

  const tx = db.transaction(() => {
    const delOpp = db.prepare('DELETE FROM arb_opportunities WHERE pair_id = ?');
    const delSnap = db.prepare('DELETE FROM price_snapshots WHERE pair_id = ?');
    const delPair = db.prepare('DELETE FROM market_pairs WHERE id = ?');
    const upd = db.prepare(
      "UPDATE market_pairs SET status = 'approved', updated_at = datetime('now') WHERE id = ?",
    );

    for (const p of dropPairs) {
      delOpp.run(p.id);
      delSnap.run(p.id);
      delPair.run(p.id);
    }
    for (const p of keepPairs) {
      upd.run(p.id);
    }
  });

  tx();

  const after = db
    .prepare("SELECT status, COUNT(*) AS c FROM market_pairs GROUP BY status")
    .all() as { status: string; c: number }[];
  const statusAfter = Object.fromEntries(after.map((r) => [r.status, r.c]));
  logger.info(`Status after: ${JSON.stringify(statusAfter)}`);

  db.close();
  logger.info('Done.');
}

main();
