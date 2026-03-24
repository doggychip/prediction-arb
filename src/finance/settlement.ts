/**
 * Auto-settlement — checks for resolved markets and settles open positions.
 *
 * When a prediction market resolves:
 *  - YES outcome: YES positions pay out 100¢/contract, NO positions pay 0
 *  - NO outcome: NO positions pay out 100¢/contract, YES positions pay 0
 */

import type Database from 'better-sqlite3';
import type { Position } from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('settlement');

export interface SettlementResult {
  positionId: number;
  accountId: string;
  platform: string;
  marketId: string;
  side: string;
  quantity: number;
  avgEntryPriceCents: number;
  outcome: 'yes' | 'no';
  payoutPerContract: number; // 100 or 0
  totalPayoutCents: number;
  realizedPnlCents: number;
  settledAt: string;
}

interface PositionRow {
  id: number;
  account_id: string;
  platform: string;
  market_id: string;
  side: string;
  quantity: number;
  avg_entry_price_cents: number;
  total_cost_cents: number;
  status: string;
  pair_id: string | null;
}

/**
 * Settle a single position given a market outcome.
 * Records payout, P&L transaction, and marks position as 'settled'.
 */
export function settlePosition(
  db: Database.Database,
  positionId: number,
  outcome: 'yes' | 'no',
): SettlementResult | null {
  let result: SettlementResult | null = null;

  const doSettle = db.transaction(() => {
    const pos = db.prepare(
      "SELECT * FROM positions WHERE id = @id AND status = 'open'",
    ).get({ id: positionId }) as PositionRow | undefined;

    if (!pos) return;

    // If position side matches outcome, payout is 100¢/contract; else 0
    const won = pos.side === outcome;
    const payoutPerContract = won ? 100 : 0;
    const totalPayout = payoutPerContract * pos.quantity;
    const realizedPnl = totalPayout - pos.total_cost_cents;

    // Credit payout to account
    const acct = db.prepare('SELECT balance_cents FROM accounts WHERE id = @id').get({
      id: pos.account_id,
    }) as { balance_cents: number };

    const newBalance = acct.balance_cents + totalPayout;

    db.prepare(
      "UPDATE accounts SET balance_cents = @balance, updated_at = datetime('now') WHERE id = @id",
    ).run({ balance: newBalance, id: pos.account_id });

    // Record settlement transaction
    db.prepare(`
      INSERT INTO transactions (account_id, type, amount_cents, balance_after_cents, reference, notes)
      VALUES (@account_id, 'pnl_realized', @amount_cents, @balance_after_cents, @reference, @notes)
    `).run({
      account_id: pos.account_id,
      amount_cents: Math.abs(realizedPnl),
      balance_after_cents: newBalance,
      reference: `settlement:position:${pos.id}`,
      notes: `Market ${pos.market_id} resolved ${outcome}. Position ${pos.side} ${won ? 'won' : 'lost'}. Payout: ${totalPayout}¢`,
    });

    // Mark position as settled
    db.prepare(`
      UPDATE positions SET status = 'settled', closed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = @id
    `).run({ id: pos.id });

    result = {
      positionId: pos.id,
      accountId: pos.account_id,
      platform: pos.platform,
      marketId: pos.market_id,
      side: pos.side,
      quantity: pos.quantity,
      avgEntryPriceCents: pos.avg_entry_price_cents,
      outcome,
      payoutPerContract,
      totalPayoutCents: totalPayout,
      realizedPnlCents: realizedPnl,
      settledAt: new Date().toISOString(),
    };
  });

  doSettle();
  return result;
}

/**
 * Settle all open positions for a given marketId and outcome.
 * Returns array of settlement results.
 */
export function settleMarket(
  db: Database.Database,
  marketId: string,
  outcome: 'yes' | 'no',
): SettlementResult[] {
  const positions = db.prepare(
    "SELECT id FROM positions WHERE market_id = @market_id AND status = 'open'",
  ).all({ market_id: marketId }) as Array<{ id: number }>;

  const results: SettlementResult[] = [];
  for (const pos of positions) {
    const r = settlePosition(db, pos.id, outcome);
    if (r) {
      results.push(r);
      logger.info(`Settled position ${r.positionId}: ${r.side} ${r.marketId} → ${outcome} (PnL: ${r.realizedPnlCents}¢)`);
    }
  }

  return results;
}

/**
 * Check Kalshi markets for resolution and auto-settle open positions.
 * Kalshi markets have a `result` field: "" (unresolved), "yes", "no", "all_no", "all_yes"
 */
export async function checkAndSettleKalshiMarkets(
  db: Database.Database,
  kalshiClient: { getMarket: (ticker: string) => Promise<{ result: string; status: string }> },
): Promise<SettlementResult[]> {
  // Find all open positions on Kalshi
  const openPositions = db.prepare(
    "SELECT DISTINCT market_id FROM positions WHERE platform = 'kalshi' AND status = 'open'",
  ).all() as Array<{ market_id: string }>;

  const allResults: SettlementResult[] = [];

  for (const { market_id } of openPositions) {
    try {
      const market = await kalshiClient.getMarket(market_id);
      if (market.result && market.result !== '') {
        const outcome = market.result === 'yes' || market.result === 'all_yes' ? 'yes' : 'no';
        logger.info(`Kalshi market ${market_id} resolved: ${market.result} → settling as ${outcome}`);
        const results = settleMarket(db, market_id, outcome);
        allResults.push(...results);
      }
    } catch (err) {
      logger.warn(`Failed to check Kalshi market ${market_id}: ${(err as Error).message}`);
    }
  }

  return allResults;
}

/**
 * Check Polymarket markets for resolution and auto-settle open positions.
 * Polymarket markets: closed=true with resolved outcome
 */
export async function checkAndSettlePolymarketMarkets(
  db: Database.Database,
  polyClient: { getMarket: (id: string) => Promise<{ closed: boolean; active: boolean; outcomePrices: string }> },
): Promise<SettlementResult[]> {
  const openPositions = db.prepare(
    "SELECT DISTINCT market_id FROM positions WHERE platform = 'polymarket' AND status = 'open'",
  ).all() as Array<{ market_id: string }>;

  const allResults: SettlementResult[] = [];

  for (const { market_id } of openPositions) {
    try {
      const market = await polyClient.getMarket(market_id);
      if (market.closed) {
        // Parse outcome prices to determine winner
        // outcomePrices is like '["1","0"]' where index 0 = yes, index 1 = no
        let outcome: 'yes' | 'no' = 'no';
        try {
          const prices = JSON.parse(market.outcomePrices || '[]');
          outcome = parseFloat(prices[0]) >= 0.5 ? 'yes' : 'no';
        } catch {
          logger.warn(`Could not parse outcomePrices for ${market_id}, defaulting to 'no'`);
        }

        logger.info(`Polymarket market ${market_id} closed → settling as ${outcome}`);
        const results = settleMarket(db, market_id, outcome);
        allResults.push(...results);
      }
    } catch (err) {
      logger.warn(`Failed to check Polymarket market ${market_id}: ${(err as Error).message}`);
    }
  }

  return allResults;
}

/**
 * Get recent settlement history from the transaction ledger.
 */
export function getSettlementHistory(db: Database.Database, limit = 50): SettlementResult[] {
  const rows = db.prepare(`
    SELECT p.id as position_id, p.account_id, p.platform, p.market_id, p.side,
           p.quantity, p.avg_entry_price_cents, p.closed_at,
           t.amount_cents, t.notes
    FROM positions p
    LEFT JOIN transactions t ON t.reference = 'settlement:position:' || p.id
    WHERE p.status = 'settled'
    ORDER BY p.closed_at DESC
    LIMIT @limit
  `).all({ limit }) as Array<{
    position_id: number;
    account_id: string;
    platform: string;
    market_id: string;
    side: string;
    quantity: number;
    avg_entry_price_cents: number;
    closed_at: string;
    amount_cents: number | null;
    notes: string | null;
  }>;

  return rows.map((r) => {
    const won = r.notes?.includes('won') ?? false;
    const payoutPerContract = won ? 100 : 0;
    return {
      positionId: r.position_id,
      accountId: r.account_id,
      platform: r.platform,
      marketId: r.market_id,
      side: r.side,
      quantity: r.quantity,
      avgEntryPriceCents: r.avg_entry_price_cents,
      outcome: (won ? r.side : r.side === 'yes' ? 'no' : 'yes') as 'yes' | 'no',
      payoutPerContract,
      totalPayoutCents: payoutPerContract * r.quantity,
      realizedPnlCents: r.amount_cents ?? 0,
      settledAt: r.closed_at,
    };
  });
}
