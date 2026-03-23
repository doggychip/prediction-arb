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

  // LLM
  openrouterApiKey: string;

  // API
  apiPort: number;

  // Database
  dbPath: string;
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

    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',

    apiPort: parseInt(process.env.API_PORT || '3000', 10),

    dbPath: process.env.DB_PATH || 'data/arb.db',
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

  return warnings;
}
