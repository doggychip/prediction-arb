import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  // Kalshi
  kalshiApiKeyId: string;
  kalshiPrivateKeyPath: string;
  kalshiEnv: 'demo' | 'prod';
  kalshiBaseUrl: string;
  kalshiWsUrl: string;

  // Polymarket
  polymarketPrivateKey: string;
  polymarketGammaUrl: string;
  polymarketClobUrl: string;
  polymarketWsUrl: string;

  // Discord
  discordWebhookUrl: string;

  // Database
  dbPath: string;

  // Arb detection thresholds
  kalshiFeeRate: number;
  polymarketFeeRate: number;
  minSpreadCents: number;
  suspectSpreadCents: number;
  alertCooldownMs: number;
  spreadChangeThreshold: number;

  // Database maintenance
  snapshotRetentionDays: number;
  arbRetentionDays: number;

  // Price cache
  priceCacheTtlMs: number;

  // HTTP request timeout
  requestTimeoutMs: number;

  // Dashboard
  dashboardPort: number;
  dashboardEnabled: boolean;

  // LLM match verification
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmVerifyEnabled: boolean;
  llmVerifyBatchSize: number;
}

function getKalshiBaseUrl(env: 'demo' | 'prod'): string {
  return env === 'prod'
    ? 'https://api.elections.kalshi.com/trade-api/v2'
    : 'https://demo-api.kalshi.co/trade-api/v2';
}

function getKalshiWsUrl(env: 'demo' | 'prod'): string {
  return env === 'prod'
    ? 'wss://api.elections.kalshi.com/trade-api/ws/v2'
    : 'wss://demo-api.kalshi.co/trade-api/ws/v2';
}

export function loadConfig(): Config {
  const kalshiEnv = (process.env.KALSHI_ENV || 'demo') as 'demo' | 'prod';

  return {
    kalshiApiKeyId: process.env.KALSHI_API_KEY_ID || '',
    kalshiPrivateKeyPath: process.env.KALSHI_PRIVATE_KEY_PATH || '',
    kalshiEnv,
    kalshiBaseUrl: getKalshiBaseUrl(kalshiEnv),
    kalshiWsUrl: getKalshiWsUrl(kalshiEnv),

    polymarketPrivateKey: process.env.POLYMARKET_PRIVATE_KEY || '',
    polymarketGammaUrl: 'https://gamma-api.polymarket.com',
    polymarketClobUrl: 'https://clob.polymarket.com',
    polymarketWsUrl: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',

    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',

    dbPath: process.env.DB_PATH || 'data/arb.db',

    // Arb detection thresholds (configurable via env)
    kalshiFeeRate: parseFloat(process.env.KALSHI_FEE_RATE || '0.07'),
    polymarketFeeRate: parseFloat(process.env.POLYMARKET_FEE_RATE || '0.02'),
    minSpreadCents: parseInt(process.env.MIN_SPREAD_CENTS || '1', 10),
    suspectSpreadCents: parseInt(process.env.SUSPECT_SPREAD_CENTS || '20', 10),
    alertCooldownMs: parseInt(process.env.ALERT_COOLDOWN_MS || String(5 * 60 * 1000), 10),
    spreadChangeThreshold: parseInt(process.env.SPREAD_CHANGE_THRESHOLD || '3', 10),

    // Database maintenance
    snapshotRetentionDays: parseInt(process.env.SNAPSHOT_RETENTION_DAYS || '7', 10),
    arbRetentionDays: parseInt(process.env.ARB_RETENTION_DAYS || '30', 10),

    // Price cache TTL (default 5 minutes)
    priceCacheTtlMs: parseInt(process.env.PRICE_CACHE_TTL_MS || String(5 * 60 * 1000), 10),

    // HTTP request timeout (default 30s)
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10),

    // Dashboard
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3456', 10),
    dashboardEnabled: process.env.DASHBOARD_ENABLED !== 'false',

    // LLM match verification
    llmApiKey: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || '',
    llmBaseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    llmModel: process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001',
    llmVerifyEnabled: process.env.LLM_VERIFY_ENABLED !== 'false',
    llmVerifyBatchSize: parseInt(process.env.LLM_VERIFY_BATCH_SIZE || '10', 10),
  };
}

export function validateConfig(config: Config): string[] {
  const warnings: string[] = [];

  if (!config.kalshiApiKeyId) {
    warnings.push('KALSHI_API_KEY_ID not set — Kalshi auth features disabled');
  }
  if (!config.discordWebhookUrl) {
    warnings.push('DISCORD_WEBHOOK_URL not set — Discord alerts disabled');
  }
  if (!config.llmApiKey && config.llmVerifyEnabled) {
    warnings.push('LLM_API_KEY not set — LLM match verification disabled');
  }

  return warnings;
}
