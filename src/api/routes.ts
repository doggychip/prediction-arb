import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  createAccount,
  getAccount,
  getAllAccounts,
  deactivateAccount,
  recordDeposit,
  recordWithdrawal,
  recordTransfer,
  getTransactions,
  getTransactionsByDateRange,
  getOpenPositions,
  getPositionsByPair,
  closePosition,
  recordTrade,
  getTradesByPosition,
  getRecentTrades,
  snapshotAllAccounts,
  getBalanceSnapshots,
  getBalanceSummary,
  getPnLSummary,
  verifyAccountBalance,
  getUnrealizedPnL,
  getDailySummary,
  getWeeklySummary,
  getFeeBreakdown,
  getTradesForExport,
  getTransactionsForExport,
  getAllPositionsForExport,
  settleMarket,
  settlePosition,
  getSettlementHistory,
  verifyAllLedgerIntegrity,
  checkExternalBalances,
  getPositionReconciliation,
} from '../finance/index.js';

function qstr(val: unknown): string {
  return typeof val === 'string' ? val : String(val ?? '');
}

function qint(val: unknown, fallback: number): number {
  if (val == null) return fallback;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? fallback : n;
}

function toCsvRow(values: (string | number | null | undefined)[]): string {
  return values.map((v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }).join(',');
}

export function createFinanceRouter(db: Database.Database): Router {
  const router = Router();

  // ── Accounts ──────────────────────────────────────────────────────

  router.get('/accounts', (_req, res) => {
    res.json(getAllAccounts(db));
  });

  router.get('/accounts/:id', (req, res) => {
    const account = getAccount(db, qstr(req.params.id));
    if (!account) {
      res.status(404).json({ error: `Account not found: ${req.params.id}` });
      return;
    }
    res.json(account);
  });

  router.post('/accounts', (req, res) => {
    try {
      const account = createAccount(db, req.body);
      res.status(201).json(account);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete('/accounts/:id', (req, res) => {
    const id = qstr(req.params.id);
    const account = getAccount(db, id);
    if (!account) {
      res.status(404).json({ error: `Account not found: ${id}` });
      return;
    }
    deactivateAccount(db, id);
    res.status(204).send();
  });

  // ── Transactions ──────────────────────────────────────────────────

  router.get('/accounts/:id/transactions', (req, res) => {
    const id = qstr(req.params.id);
    const limit = qint(req.query.limit, 100);
    const start = req.query.start ? qstr(req.query.start) : undefined;
    const end = req.query.end ? qstr(req.query.end) : undefined;

    if (start && end) {
      res.json(getTransactionsByDateRange(db, id, start, end));
    } else {
      res.json(getTransactions(db, id, limit));
    }
  });

  router.post('/accounts/:id/deposits', (req, res) => {
    try {
      const txn = recordDeposit(db, { ...req.body, accountId: qstr(req.params.id) });
      res.status(201).json(txn);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/accounts/:id/withdrawals', (req, res) => {
    try {
      const txn = recordWithdrawal(db, { ...req.body, accountId: qstr(req.params.id) });
      res.status(201).json(txn);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/transfers', (req, res) => {
    try {
      const result = recordTransfer(db, req.body);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ── Positions ─────────────────────────────────────────────────────

  router.get('/positions', (req, res) => {
    const accountId = req.query.accountId ? qstr(req.query.accountId) : undefined;
    res.json(getOpenPositions(db, accountId));
  });

  router.get('/positions/pair/:pairId', (req, res) => {
    res.json(getPositionsByPair(db, qstr(req.params.pairId)));
  });

  router.post('/positions/:id/close', (req, res) => {
    try {
      closePosition(db, qint(req.params.id, 0));
      res.status(204).send();
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ── Trades ────────────────────────────────────────────────────────

  router.post('/trades', (req, res) => {
    try {
      const trade = recordTrade(db, req.body);
      res.status(201).json(trade);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/trades/recent', (req, res) => {
    const limit = qint(req.query.limit, 50);
    res.json(getRecentTrades(db, limit));
  });

  router.get('/positions/:id/trades', (req, res) => {
    res.json(getTradesByPosition(db, qint(req.params.id, 0)));
  });

  // ── Snapshots ─────────────────────────────────────────────────────

  router.post('/snapshots', (_req, res) => {
    snapshotAllAccounts(db);
    res.status(201).json({ message: 'Snapshots created for all active accounts' });
  });

  router.get('/accounts/:id/snapshots', (req, res) => {
    const limit = qint(req.query.limit, 100);
    res.json(getBalanceSnapshots(db, qstr(req.params.id), limit));
  });

  // ── Reports ───────────────────────────────────────────────────────

  router.get('/reports/balance-summary', (_req, res) => {
    res.json(getBalanceSummary(db));
  });

  router.get('/reports/pnl', (req, res) => {
    const start = req.query.start ? qstr(req.query.start) : '2000-01-01';
    const end = req.query.end ? qstr(req.query.end) : '2099-12-31';
    res.json(getPnLSummary(db, start, end));
  });

  router.get('/reports/unrealized-pnl', (_req, res) => {
    res.json(getUnrealizedPnL(db));
  });

  router.get('/reports/daily-summary', (req, res) => {
    const date = req.query.date ? qstr(req.query.date) : new Date().toISOString().split('T')[0];
    res.json(getDailySummary(db, date));
  });

  router.get('/reports/weekly-summary', (req, res) => {
    const end = req.query.end ? qstr(req.query.end) : new Date().toISOString().split('T')[0];
    const startDefault = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const start = req.query.start ? qstr(req.query.start) : startDefault;
    res.json(getWeeklySummary(db, start, end));
  });

  router.get('/reports/fee-breakdown', (req, res) => {
    const start = req.query.start ? qstr(req.query.start) : '2000-01-01';
    const end = req.query.end ? qstr(req.query.end) : '2099-12-31';
    res.json(getFeeBreakdown(db, start, end));
  });

  router.get('/accounts/:id/verify', (req, res) => {
    try {
      res.json(verifyAccountBalance(db, qstr(req.params.id)));
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // ── Settlement ────────────────────────────────────────────────────

  router.post('/settlement/market', (req, res) => {
    try {
      const { marketId, outcome } = req.body;
      if (!marketId || !outcome) {
        res.status(400).json({ error: 'marketId and outcome (yes/no) are required' });
        return;
      }
      if (outcome !== 'yes' && outcome !== 'no') {
        res.status(400).json({ error: 'outcome must be "yes" or "no"' });
        return;
      }
      const results = settleMarket(db, marketId, outcome);
      res.json({ settled: results.length, results });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/settlement/position/:id', (req, res) => {
    try {
      const { outcome } = req.body;
      if (outcome !== 'yes' && outcome !== 'no') {
        res.status(400).json({ error: 'outcome must be "yes" or "no"' });
        return;
      }
      const result = settlePosition(db, qint(req.params.id, 0), outcome);
      if (!result) {
        res.status(404).json({ error: 'Position not found or already settled' });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/settlement/history', (req, res) => {
    const limit = qint(req.query.limit, 50);
    res.json(getSettlementHistory(db, limit));
  });

  // ── Reconciliation ────────────────────────────────────────────────

  router.get('/reconciliation/ledger-integrity', (_req, res) => {
    res.json(verifyAllLedgerIntegrity(db));
  });

  router.post('/reconciliation/external-balances', (req, res) => {
    try {
      const { balances } = req.body;
      if (!Array.isArray(balances)) {
        res.status(400).json({ error: 'balances must be an array of { accountId, reportedBalanceCents }' });
        return;
      }
      res.json(checkExternalBalances(db, balances));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/reconciliation/positions', (_req, res) => {
    res.json(getPositionReconciliation(db));
  });

  // ── CSV Exports ───────────────────────────────────────────────────

  router.get('/exports/trades.csv', (req, res) => {
    const start = req.query.start ? qstr(req.query.start) : undefined;
    const end = req.query.end ? qstr(req.query.end) : undefined;
    const trades = getTradesForExport(db, start, end);

    const header = 'id,positionId,accountId,platform,marketId,side,direction,quantity,priceCents,totalCents,feeCents,realizedPnlCents,pairId,externalId,executedAt';
    const rows = trades.map((t) => toCsvRow([
      t.id, t.positionId, t.accountId, t.platform, t.marketId, t.side, t.direction,
      t.quantity, t.priceCents, t.totalCents, t.feeCents, t.realizedPnlCents,
      t.pairId, t.externalId, t.executedAt,
    ]));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
    res.send([header, ...rows].join('\n'));
  });

  router.get('/exports/transactions.csv', (req, res) => {
    const accountId = req.query.accountId ? qstr(req.query.accountId) : undefined;
    const start = req.query.start ? qstr(req.query.start) : undefined;
    const end = req.query.end ? qstr(req.query.end) : undefined;
    const txns = getTransactionsForExport(db, accountId, start, end);

    const header = 'id,accountId,type,amountCents,balanceAfterCents,relatedTransactionId,reference,notes,createdAt';
    const rows = txns.map((t) => toCsvRow([
      t.id, t.accountId, t.type, t.amountCents, t.balanceAfterCents,
      t.relatedTransactionId, t.reference, t.notes, t.createdAt,
    ]));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send([header, ...rows].join('\n'));
  });

  router.get('/exports/positions.csv', (_req, res) => {
    const positions = getAllPositionsForExport(db);

    const header = 'id,accountId,platform,marketId,side,quantity,avgEntryPriceCents,totalCostCents,status,pairId,openedAt,closedAt';
    const rows = positions.map((p) => toCsvRow([
      p.id, p.accountId, p.platform, p.marketId, p.side, p.quantity,
      p.avgEntryPriceCents, p.totalCostCents, p.status, p.pairId,
      p.openedAt, p.closedAt,
    ]));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="positions.csv"');
    res.send([header, ...rows].join('\n'));
  });

  return router;
}
