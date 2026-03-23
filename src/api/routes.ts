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
} from '../finance/index.js';

function qstr(val: unknown): string {
  return typeof val === 'string' ? val : String(val ?? '');
}

function qint(val: unknown, fallback: number): number {
  if (val == null) return fallback;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? fallback : n;
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

  router.get('/accounts/:id/verify', (req, res) => {
    try {
      res.json(verifyAccountBalance(db, qstr(req.params.id)));
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  return router;
}
