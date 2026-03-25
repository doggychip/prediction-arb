import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../logger.js';

const logger = createLogger('db');

const SCHEMA_SQL = `
-- Polymarket markets
CREATE TABLE IF NOT EXISTS polymarket_markets (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  condition_id TEXT,
  slug TEXT,
  outcomes TEXT,
  clob_token_ids TEXT,
  description TEXT,
  volume TEXT,
  volume_24hr REAL,
  liquidity TEXT,
  active INTEGER DEFAULT 1,
  closed INTEGER DEFAULT 0,
  end_date TEXT,
  tags TEXT,
  neg_risk INTEGER DEFAULT 0,
  event_slug TEXT,
  event_title TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Matched market pairs
CREATE TABLE IF NOT EXISTS market_pairs (
  id TEXT PRIMARY KEY,
  polymarket_id TEXT NOT NULL REFERENCES polymarket_markets(id),
  match_confidence REAL NOT NULL,
  resolution_divergence_risk REAL DEFAULT 0,
  match_method TEXT,
  status TEXT DEFAULT 'pending_review',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Logged arbitrage opportunities
CREATE TABLE IF NOT EXISTS arb_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id TEXT NOT NULL REFERENCES market_pairs(id),
  polymarket_id TEXT NOT NULL,
  poly_yes_bid INTEGER,
  poly_yes_ask INTEGER,
  poly_no_bid INTEGER,
  poly_no_ask INTEGER,
  best_spread_cents INTEGER,
  strategy TEXT,
  estimated_fees_cents INTEGER,
  net_spread_cents INTEGER,
  available_depth_dollars REAL,
  detected_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  duration_ms INTEGER
);

-- Price snapshots for backtesting
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id TEXT NOT NULL REFERENCES market_pairs(id),
  poly_yes_bid INTEGER,
  poly_yes_ask INTEGER,
  spread_cents INTEGER,
  timestamp TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_arb_pair_id ON arb_opportunities(pair_id);
CREATE INDEX IF NOT EXISTS idx_arb_detected_at ON arb_opportunities(detected_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_pair_id ON price_snapshots(pair_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON price_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_poly_active ON polymarket_markets(active);

-- ============================================================
-- Financial system tables
-- ============================================================

-- Platform accounts (funded accounts on each exchange or external)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Immutable transaction ledger
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  related_transaction_id INTEGER,
  reference TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Open / closed positions
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  platform TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  avg_entry_price_cents INTEGER NOT NULL,
  total_cost_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  pair_id TEXT REFERENCES market_pairs(id),
  opened_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(account_id, market_id, side, status)
);

-- Individual trade / fill records
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER REFERENCES positions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  platform TEXT NOT NULL,
  market_id TEXT NOT NULL,
  side TEXT NOT NULL,
  direction TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  realized_pnl_cents INTEGER,
  pair_id TEXT REFERENCES market_pairs(id),
  external_id TEXT,
  notes TEXT,
  executed_at TEXT DEFAULT (datetime('now'))
);

-- Periodic balance snapshots for time-series reporting
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  balance_cents INTEGER NOT NULL,
  unrealized_pnl_cents INTEGER DEFAULT 0,
  timestamp TEXT DEFAULT (datetime('now'))
);

-- Financial system indexes
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_pair ON positions(pair_id);
CREATE INDEX IF NOT EXISTS idx_trades_position ON trades(position_id);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_executed ON trades(executed_at);
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_account ON balance_snapshots(account_id);
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_timestamp ON balance_snapshots(timestamp);
`;

export function initDatabase(dbPath: string): Database.Database {
  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  logger.info(`Initializing SQLite database at ${dbPath}`);
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create all tables
  db.exec(SCHEMA_SQL);

  logger.info('Database schema initialized');
  return db;
}
