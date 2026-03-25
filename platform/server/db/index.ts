import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../shared/schema.js";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DB_PATH || "data/platform.db";

// Ensure directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// Create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS creators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    bio TEXT,
    avatar_url TEXT,
    verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES creators(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    long_description TEXT,
    category TEXT NOT NULL,
    tags TEXT,
    endpoint_url TEXT NOT NULL,
    health_check_url TEXT,
    docs_url TEXT,
    pricing TEXT NOT NULL DEFAULT 'free',
    price_per_call REAL DEFAULT 0,
    monthly_price REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    rate_limit INTEGER DEFAULT 100,
    version TEXT DEFAULT '1.0.0',
    schema TEXT,
    health_status TEXT DEFAULT 'unknown',
    health_checked_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES creators(id),
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    prefix TEXT NOT NULL,
    scopes TEXT DEFAULT 'read',
    last_used_at TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES creators(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    status TEXT NOT NULL DEFAULT 'active',
    plan TEXT NOT NULL DEFAULT 'free',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id TEXT NOT NULL REFERENCES api_keys(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER,
    latency_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES creators(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agents_creator ON agents(creator_id);
  CREATE INDEX IF NOT EXISTS idx_agents_category ON agents(category);
  CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_agent ON subscriptions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_key ON usage_logs(api_key_id);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_agent ON usage_logs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES creators(id),
    url TEXT NOT NULL,
    events TEXT NOT NULL,
    secret TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES creators(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    read INTEGER DEFAULT 0,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES creators(id),
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS billing_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES creators(id) UNIQUE,
    stripe_customer_id TEXT,
    stripe_connect_id TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES creators(id),
    agent_id TEXT REFERENCES agents(id),
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'pending',
    stripe_payment_intent_id TEXT,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
  CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

`);

// Migrations for existing DBs
try {
  sqlite.exec(`ALTER TABLE agents ADD COLUMN health_status TEXT DEFAULT 'unknown'`);
} catch { /* column already exists */ }
try {
  sqlite.exec(`ALTER TABLE agents ADD COLUMN health_checked_at TEXT`);
} catch { /* column already exists */ }
try {
  sqlite.exec(`ALTER TABLE creators ADD COLUMN email_verified INTEGER DEFAULT 0`);
} catch { /* column already exists */ }

console.log(`[db] Connected to ${DB_PATH}`);
