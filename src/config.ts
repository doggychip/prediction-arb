import dotenv from 'dotenv';

dotenv.config();

export interface Config {
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

export function loadConfig(): Config {
  return {
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

  if (!config.discordWebhookUrl) {
    warnings.push('DISCORD_WEBHOOK_URL not set — Discord alerts disabled');
  }

  return warnings;
}
