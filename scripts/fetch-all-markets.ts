/**
 * Standalone script: Fetch all markets from both platforms and store in SQLite.
 * Usage: npm run fetch-markets
 */

import { loadConfig, validateConfig } from '../src/config.js';
import { initDatabase } from '../src/store/db.js';
import { upsertKalshiMarkets, upsertPolymarketMarkets } from '../src/store/models.js';
import { KalshiClient } from '../src/kalshi/client.js';
import { PolymarketClient } from '../src/polymarket/client.js';
import { createLogger } from '../src/logger.js';

const logger = createLogger('fetch-markets');

async function main() {
  logger.info('=== Fetching all markets ===');

  const config = loadConfig();
  const warnings = validateConfig(config);
  for (const w of warnings) {
    logger.warn(w);
  }

  const db = initDatabase(config.dbPath);
  const kalshiClient = new KalshiClient(config);
  const polyClient = new PolymarketClient(config);

  // Fetch Kalshi markets
  logger.info('Fetching Kalshi markets...');
  try {
    const kalshiMarkets = await kalshiClient.getAllMarkets({ status: 'open' });
    upsertKalshiMarkets(db, kalshiMarkets);
    logger.info(`Stored ${kalshiMarkets.length} Kalshi markets`);
  } catch (err) {
    logger.error('Failed to fetch Kalshi markets', { error: (err as Error).message });
  }

  // Fetch Polymarket markets
  logger.info('Fetching Polymarket markets...');
  try {
    const polyMarkets = await polyClient.getAllMarkets({ active: true, closed: false });
    upsertPolymarketMarkets(db, polyMarkets);
    logger.info(`Stored ${polyMarkets.length} Polymarket markets`);
  } catch (err) {
    logger.error('Failed to fetch Polymarket markets', { error: (err as Error).message });
  }

  db.close();
  logger.info('=== Done ===');
}

main().catch((err) => {
  logger.error('Fatal error', { error: (err as Error).message });
  process.exit(1);
});
