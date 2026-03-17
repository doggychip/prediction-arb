import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../logger.js';

const logger = createLogger('db');

const SCHEMA_SQL = `
-- Kalshi markets
CREATE TABLE IF NOT EXISTS kalshi_markets (
  ticker TEXT PRIMARY KEY,
  event_ticker TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  category TEXT,
  status TEXT NOT NULL,
  yes_bid INTEGER,
  yes_ask INTEGER,
  no_bid INTEGER,
  no_ask INTEGER,
  last_price INTEGER,
  volume INTEGER,
  volume_24h INTEGER,
  open_interest INTEGER,
  rules_primary TEXT,
  close_time TEXT,
  notional_value INTEGER DEFAULT 100,
  updated_at TEXT DEFAULT (datetime('now'))
);

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
  kalshi_ticker TEXT NOT NULL REFERENCES kalshi_markets(ticker),
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
  kalshi_ticker TEXT NOT NULL,
  polymarket_id TEXT NOT NULL,
  kalshi_yes_bid INTEGER,
  kalshi_yes_ask INTEGER,
  kalshi_no_bid INTEGER,
  kalshi_no_ask INTEGER,
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
  kalshi_yes_bid INTEGER,
  kalshi_yes_ask INTEGER,
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
CREATE INDEX IF NOT EXISTS idx_kalshi_status ON kalshi_markets(status);
CREATE INDEX IF NOT EXISTS idx_poly_active ON polymarket_markets(active);
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
