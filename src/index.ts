import { loadConfig, validateConfig } from './config.js';
import { initDatabase } from './store/db.js';
import {
  upsertKalshiMarkets,
  upsertPolymarketMarkets,
  getActiveKalshiMarkets,
  getActivePolymarketMarkets,
  upsertMarketPair,
  getApprovedPairs,
  insertArbOpportunity,
  insertPriceSnapshot,
} from './store/models.js';
import { KalshiClient } from './kalshi/client.js';
import { KalshiWebSocket } from './kalshi/websocket.js';
import { PolymarketClient } from './polymarket/client.js';
import { PolymarketWebSocket } from './polymarket/websocket.js';
import { findMatches, candidatesToPairs } from './matching/matcher.js';
import { analyzeArb, dollarsToCents, type PairPrices } from './arb/detector.js';
import { sendDiscordAlert } from './alerts/discord.js';
import { snapshotAllAccounts } from './finance/index.js';
import { startApiServer } from './api/server.js';
import type { PriceUpdate } from './types.js';
import { kalshiDollarsToCents, type KalshiMarket } from './kalshi/types.js';
import { createLogger } from './logger.js';

const logger = createLogger('main');

// In-memory price cache for matched pairs
interface PriceCache {
  kalshiYesBid: number;
  kalshiYesAsk: number;
  kalshiNoBid: number;
  kalshiNoAsk: number;
  polyYesBid: number;
  polyYesAsk: number;
}

const priceCache = new Map<string, PriceCache>(); // key = pairId

// Map from ticker/tokenId to pair info for WS updates
interface PairRef {
  pairId: string;
  kalshiTicker: string;
  polymarketId: string;
  polyYesTokenId: string;
  kalshiTitle: string;
  polyQuestion: string;
}

const kalshiTickerToPairs = new Map<string, PairRef[]>();
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

  // Initialize REST clients
  const kalshiClient = new KalshiClient(config);
  const polyClient = new PolymarketClient(config);

  // --- Step 1: Fetch all active markets ---
  logger.info('Fetching active markets from both platforms...');

  let kalshiMarkets: KalshiMarket[] = [];
  try {
    // Kalshi API: filter=open returns status='active' in response; mve_filter=exclude skips parlays server-side
    const allKalshi = await kalshiClient.getAllMarkets({ status: 'open', mve_filter: 'exclude' });
    logger.info(`Fetched ${allKalshi.length} Kalshi markets (open, non-MVE)`);

    // Client-side filter: volume + valid bid/ask prices
    kalshiMarkets = allKalshi.filter((m) => {
      // API returns 'active' when filtered by 'open'
      if (m.status !== 'open' && m.status !== 'active') return false;
      const vol = parseFloat(m.volume_fp || '0');
      const vol24h = parseFloat(m.volume_24h_fp || '0');
      if (vol24h <= 0 && vol <= 100) return false;
      const yesBid = kalshiDollarsToCents(m.yes_bid_dollars);
      const yesAsk = kalshiDollarsToCents(m.yes_ask_dollars);
      if (yesAsk <= 0 || yesBid <= 0) return false;
      return true;
    });
    upsertKalshiMarkets(db, kalshiMarkets);
    logger.info(`Stored ${kalshiMarkets.length} active Kalshi markets (filtered by volume + valid prices)`);
  } catch (err) {
    logger.error('Failed to fetch Kalshi markets', { error: (err as Error).message });
    kalshiMarkets = getActiveKalshiMarkets(db) as KalshiMarket[];
    logger.info(`Using ${kalshiMarkets.length} cached Kalshi markets from DB`);
  }

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

  if (kalshiMarkets.length === 0 || polyMarkets.length === 0) {
    logger.error('No markets available on one or both platforms. Exiting.');
    db.close();
    process.exit(1);
  }

  // --- Step 2: Match markets ---
  logger.info('Running market matcher...');
  const candidates = findMatches(kalshiMarkets, polyMarkets, 0.45);
  const pairs = candidatesToPairs(candidates);

  for (const pair of pairs) {
    upsertMarketPair(db, pair);
  }
  logger.info(`Stored ${pairs.length} market pair candidates`);

  // Load all pairs (including previously approved ones)
  const allPairs = getApprovedPairs(db);
  if (allPairs.length === 0) {
    logger.warn('No market pairs found. The engine will wait for matches. Consider lowering the confidence threshold or adding manual pairs.');
  }

  // --- Step 3: Build lookup maps and initialize price cache ---
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
      kalshiTicker: row.kalshi_ticker,
      polymarketId: row.polymarket_id,
      polyYesTokenId,
      kalshiTitle: row.kalshi_title,
      polyQuestion: row.poly_question,
    };

    if (!kalshiTickerToPairs.has(row.kalshi_ticker)) {
      kalshiTickerToPairs.set(row.kalshi_ticker, []);
    }
    kalshiTickerToPairs.get(row.kalshi_ticker)!.push(ref);

    if (!polyTokenToPairs.has(polyYesTokenId)) {
      polyTokenToPairs.set(polyYesTokenId, []);
    }
    polyTokenToPairs.get(polyYesTokenId)!.push(ref);

    // Seed price cache from DB/REST data
    const km = kalshiMarkets.find((m) => m.ticker === row.kalshi_ticker);
    const pm = polyMarkets.find((m: any) => m.id === row.polymarket_id);
    if (km && pm) {
      let polyYesBid = 0;
      let polyYesAsk = 0;
      try {
        const prices = JSON.parse(pm.outcomePrices || '[]');
        if (prices[0]) {
          polyYesBid = dollarsToCents(prices[0]);
          polyYesAsk = dollarsToCents(prices[0]);
        }
      } catch { /* ignore */ }

      priceCache.set(row.id, {
        kalshiYesBid: kalshiDollarsToCents(km.yes_bid_dollars),
        kalshiYesAsk: kalshiDollarsToCents(km.yes_ask_dollars),
        kalshiNoBid: kalshiDollarsToCents(km.no_bid_dollars),
        kalshiNoAsk: kalshiDollarsToCents(km.no_ask_dollars),
        polyYesBid,
        polyYesAsk,
      });
    }
  }

  const kalshiTickers = Array.from(kalshiTickerToPairs.keys());
  const polyTokenIds = Array.from(polyTokenToPairs.keys());

  logger.info(`Tracking ${kalshiTickers.length} Kalshi tickers and ${polyTokenIds.length} Polymarket tokens`);

  // --- Step 4: Start WebSocket connections ---
  const kalshiWs = new KalshiWebSocket(config);
  const polyWs = new PolymarketWebSocket(config);

  kalshiWs.on('priceUpdate', (update: PriceUpdate) => {
    handlePriceUpdate(db, config, update);
  });

  polyWs.on('priceUpdate', (update: PriceUpdate) => {
    handlePriceUpdate(db, config, update);
  });

  if (kalshiTickers.length > 0) {
    kalshiWs.connect();
    kalshiWs.subscribe(kalshiTickers);
  }

  if (polyTokenIds.length > 0) {
    polyWs.connect();
    polyWs.subscribe(polyTokenIds);
  }

  // --- Step 5: Periodic stats logging & balance snapshots ---
  // Snapshot account balances on startup and every 15 minutes
  snapshotAllAccounts(db);
  const BALANCE_SNAPSHOT_INTERVAL_MS = 15 * 60_000;
  setInterval(() => snapshotAllAccounts(db), BALANCE_SNAPSHOT_INTERVAL_MS);

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
    kalshiWs.close();
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
  // Find relevant pairs
  let pairRefs: PairRef[] | undefined;

  if (update.platform === 'kalshi') {
    pairRefs = kalshiTickerToPairs.get(update.ticker);
  } else {
    pairRefs = polyTokenToPairs.get(update.ticker);
  }

  if (!pairRefs || pairRefs.length === 0) return;

  for (const ref of pairRefs) {
    let cache = priceCache.get(ref.pairId);
    if (!cache) {
      cache = {
        kalshiYesBid: 0,
        kalshiYesAsk: 0,
        kalshiNoBid: 0,
        kalshiNoAsk: 0,
        polyYesBid: 0,
        polyYesAsk: 0,
      };
      priceCache.set(ref.pairId, cache);
    }

    // Update cache with new prices
    if (update.platform === 'kalshi') {
      if (update.yesBid !== undefined) cache.kalshiYesBid = update.yesBid;
      if (update.yesAsk !== undefined) cache.kalshiYesAsk = update.yesAsk;
      if (update.noBid !== undefined) cache.kalshiNoBid = update.noBid;
      if (update.noAsk !== undefined) cache.kalshiNoAsk = update.noAsk;
    } else {
      if (update.yesBid !== undefined) cache.polyYesBid = update.yesBid;
      if (update.yesAsk !== undefined) cache.polyYesAsk = update.yesAsk;
    }

    // Skip if we don't have prices from both sides
    if (cache.kalshiYesAsk === 0 || cache.polyYesBid === 0) return;

    // Run arb detection
    const prices: PairPrices = {
      pairId: ref.pairId,
      kalshiTicker: ref.kalshiTicker,
      polymarketId: ref.polymarketId,
      kalshiYesBid: cache.kalshiYesBid,
      kalshiYesAsk: cache.kalshiYesAsk,
      kalshiNoBid: cache.kalshiNoBid,
      kalshiNoAsk: cache.kalshiNoAsk,
      polyYesBid: cache.polyYesBid,
      polyYesAsk: cache.polyYesAsk,
    };

    const analysis = analyzeArb(prices);

    // Log price snapshot
    try {
      insertPriceSnapshot(db, {
        pairId: ref.pairId,
        kalshiYesBid: cache.kalshiYesBid,
        kalshiYesAsk: cache.kalshiYesAsk,
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
          ref.kalshiTitle,
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
