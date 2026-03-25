/**
 * Standalone script: Fetch all markets from Polymarket and store in SQLite.
 * Usage: npm run fetch-markets
 */

import { loadConfig, validateConfig } from '../src/config.js';
import { initDatabase } from '../src/store/db.js';
import { upsertPolymarketMarkets } from '../src/store/models.js';
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
  const polyClient = new PolymarketClient(config);

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
