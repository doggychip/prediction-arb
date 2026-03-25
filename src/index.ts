import { loadConfig, validateConfig } from './config.js';
import { initDatabase } from './store/db.js';
import {
  upsertPolymarketMarkets,
  getActivePolymarketMarkets,
  getApprovedPairs,
  insertArbOpportunity,
  insertPriceSnapshot,
} from './store/models.js';
import { PolymarketClient } from './polymarket/client.js';
import { PolymarketWebSocket } from './polymarket/websocket.js';
import { analyzeArb, dollarsToCents, type PairPrices } from './arb/detector.js';
import { sendDiscordAlert } from './alerts/discord.js';
import {
  snapshotAllAccounts,
  getPriceCache,
  updatePriceCache,
  checkAndSettlePolymarketMarkets,
} from './finance/index.js';
import type { PriceCacheEntry } from './finance/prices.js';
import { startApiServer } from './api/server.js';
import type { PriceUpdate } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('main');

// Shared price cache (also used by finance modules for mark-to-market)
const priceCache = getPriceCache();

// Map from tokenId to pair info for WS updates
interface PairRef {
  pairId: string;
  polymarketId: string;
  polyYesTokenId: string;
  polyQuestion: string;
}

const polyTokenToPairs = new Map<string, PairRef[]>();

let statsOppsFound = 0;
let statsAlertssSent = 0;
let statsSuppressed = 0;

// Alert cooldown: pairId -> { lastAlertTime, lastNetSpread }
const alertCooldown = new Map<string, { lastAlertTime: number; lastNetSpread: number }>();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const SPREAD_CHANGE_THRESHOLD = 3; // re-alert if net spread changes by >= 3¢

async function main() {
  logger.info('=== prediction-arb starting ===');

  // Load config
  const config = loadConfig();
  const warnings = validateConfig(config);
  for (const w of warnings) {
    logger.warn(w);
  }

  // Initialize database
  const db = initDatabase(config.dbPath);

  // Start Finance API server
  startApiServer(db, config.apiPort);

  // Initialize REST client
  const polyClient = new PolymarketClient(config);

  // --- Step 1: Fetch all active markets ---
  logger.info('Fetching active markets from Polymarket...');

  let polyMarkets: any[] = [];
  try {
    // Only fetch active, non-closed markets with orderbook enabled
    const fetched = await polyClient.getAllMarkets({ active: true, closed: false });
    // Filter to tradeable markets with volume
    polyMarkets = fetched.filter((m: any) =>
      m.active &&
      !m.closed &&
      m.enableOrderBook &&
      m.clobTokenIds &&
      (m.volume24hr > 0 || parseFloat(m.volume || '0') > 100)
    );
    upsertPolymarketMarkets(db, polyMarkets);
    logger.info(`Stored ${polyMarkets.length} active Polymarket markets (filtered by orderbook + volume)`);
  } catch (err) {
    logger.error('Failed to fetch Polymarket markets', { error: (err as Error).message });
    polyMarkets = getActivePolymarketMarkets(db);
    logger.info(`Using ${polyMarkets.length} cached Polymarket markets from DB`);
  }

  if (polyMarkets.length === 0) {
    logger.error('No markets available. Exiting.');
    db.close();
    process.exit(1);
  }

  // Load all pairs (including previously approved ones)
  const allPairs = getApprovedPairs(db);
  if (allPairs.length === 0) {
    logger.warn('No market pairs found. The engine will wait for matches.');
  }

  // --- Step 2: Build lookup maps and initialize price cache ---
  for (const row of allPairs) {
    let polyYesTokenId = '';
    try {
      const tokenIds = JSON.parse(row.poly_clob_token_ids || '[]');
      polyYesTokenId = tokenIds[0] || '';
    } catch {
      logger.warn(`Failed to parse clobTokenIds for pair ${row.id}`);
      continue;
    }

    if (!polyYesTokenId) continue;

    const ref: PairRef = {
      pairId: row.id,
      polymarketId: row.polymarket_id,
      polyYesTokenId,
      polyQuestion: row.poly_question,
    };

    if (!polyTokenToPairs.has(polyYesTokenId)) {
      polyTokenToPairs.set(polyYesTokenId, []);
    }
    polyTokenToPairs.get(polyYesTokenId)!.push(ref);

    // Seed price cache from DB/REST data
    const pm = polyMarkets.find((m: any) => m.id === row.polymarket_id);
    if (pm) {
      let polyYesBid = 0;
      let polyYesAsk = 0;
      try {
        const prices = JSON.parse(pm.outcomePrices || '[]');
        if (prices[0]) {
          polyYesBid = dollarsToCents(prices[0]);
          polyYesAsk = dollarsToCents(prices[0]);
        }
      } catch { /* ignore */ }

      updatePriceCache(row.id, {
        polyYesBid,
        polyYesAsk,
        updatedAt: Date.now(),
      });
    }
  }

  const polyTokenIds = Array.from(polyTokenToPairs.keys());

  logger.info(`Tracking ${polyTokenIds.length} Polymarket tokens`);

  // --- Step 3: Start WebSocket connection ---
  const polyWs = new PolymarketWebSocket(config);

  polyWs.on('priceUpdate', (update: PriceUpdate) => {
    handlePriceUpdate(db, config, update);
  });

  if (polyTokenIds.length > 0) {
    polyWs.connect();
    polyWs.subscribe(polyTokenIds);
  }

  // --- Step 4: Periodic stats logging, balance snapshots & settlement ---
  // Snapshot account balances on startup and every 15 minutes
  snapshotAllAccounts(db);
  const BALANCE_SNAPSHOT_INTERVAL_MS = 15 * 60_000;
  setInterval(() => snapshotAllAccounts(db), BALANCE_SNAPSHOT_INTERVAL_MS);

  // Auto-settlement: check for resolved markets every 5 minutes
  const SETTLEMENT_CHECK_INTERVAL_MS = 5 * 60_000;
  const runSettlementCheck = async () => {
    try {
      const polyResults = await checkAndSettlePolymarketMarkets(db, polyClient);
      if (polyResults.length > 0) {
        logger.info(`Auto-settlement: settled ${polyResults.length} Polymarket positions`);
      }
    } catch (err) {
      logger.error('Settlement check failed', { error: (err as Error).message });
    }
  };
  // Run initial check after 30s, then every 5 minutes
  setTimeout(runSettlementCheck, 30_000);
  setInterval(runSettlementCheck, SETTLEMENT_CHECK_INTERVAL_MS);

  const STATS_INTERVAL_MS = 60_000;
  setInterval(() => {
    logger.info(
      `[Stats] Pairs: ${allPairs.length} | Opps found: ${statsOppsFound} | Alerts sent: ${statsAlertssSent} | ` +
      `Suppressed: ${statsSuppressed} | Cache size: ${priceCache.size}`,
    );
  }, STATS_INTERVAL_MS);

  // --- Graceful shutdown ---
  const shutdown = () => {
    logger.info('Shutting down...');
    polyWs.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('=== prediction-arb engine running ===');
}

function handlePriceUpdate(
  db: ReturnType<typeof initDatabase>,
  config: ReturnType<typeof loadConfig>,
  update: PriceUpdate,
) {
  const pairRefs = polyTokenToPairs.get(update.ticker);

  if (!pairRefs || pairRefs.length === 0) return;

  for (const ref of pairRefs) {
    let cache = priceCache.get(ref.pairId);
    if (!cache) {
      cache = {
        polyYesBid: 0,
        polyYesAsk: 0,
        updatedAt: Date.now(),
      };
      priceCache.set(ref.pairId, cache);
    }

    // Update cache with new prices
    if (update.yesBid !== undefined) cache.polyYesBid = update.yesBid;
    if (update.yesAsk !== undefined) cache.polyYesAsk = update.yesAsk;
    cache.updatedAt = Date.now();

    // Skip if we don't have prices
    if (cache.polyYesBid === 0 || cache.polyYesAsk === 0) return;

    // Run arb detection
    const prices: PairPrices = {
      pairId: ref.pairId,
      polymarketId: ref.polymarketId,
      polyYesBid: cache.polyYesBid,
      polyYesAsk: cache.polyYesAsk,
    };

    const analysis = analyzeArb(prices);

    // Log price snapshot
    try {
      insertPriceSnapshot(db, {
        pairId: ref.pairId,
        polyYesBid: cache.polyYesBid,
        polyYesAsk: cache.polyYesAsk,
        spreadCents: analysis.best?.bestSpreadCents ?? 0,
      });
    } catch (err) {
      logger.error('Failed to insert price snapshot', { error: (err as Error).message });
    }

    // If arb opportunity found, log and alert (with cooldown)
    if (analysis.best) {
      statsOppsFound++;

      try {
        insertArbOpportunity(db, analysis.best);
      } catch (err) {
        logger.error('Failed to insert arb opportunity', { error: (err as Error).message });
      }

      // Alert cooldown: suppress duplicate alerts for same pair within window
      // unless the spread has changed meaningfully
      const now = Date.now();
      const cooldownEntry = alertCooldown.get(ref.pairId);
      const spreadChanged = cooldownEntry
        ? Math.abs(analysis.best.netSpreadCents - cooldownEntry.lastNetSpread) >= SPREAD_CHANGE_THRESHOLD
        : true;
      const cooldownExpired = cooldownEntry
        ? (now - cooldownEntry.lastAlertTime) >= ALERT_COOLDOWN_MS
        : true;

      if (cooldownExpired || spreadChanged) {
        alertCooldown.set(ref.pairId, { lastAlertTime: now, lastNetSpread: analysis.best.netSpreadCents });

        sendDiscordAlert(
          config.discordWebhookUrl,
          analysis.best,
          ref.polyQuestion,
        ).then(() => {
          statsAlertssSent++;
        }).catch(() => {
          // Already logged inside sendDiscordAlert
        });
      } else {
        statsSuppressed++;
      }
    }
  }
}

main().catch((err) => {
  logger.error('Fatal error', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
