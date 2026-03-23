/**
 * HTTP API layer for the arb engine.
 * Exposes real-time data so the platform can proxy calls to it.
 *
 * Endpoints:
 *   POST /api/scan      — returns current opportunities (platform proxy target)
 *   GET  /api/opportunities — recent arb opportunities
 *   GET  /api/pairs     — tracked market pairs with live prices
 *   GET  /api/status    — engine health and stats
 */

import http from 'http';
import {
  priceCache,
  kalshiTickerToPairs,
  polyTokenToPairs,
  recentOpportunities,
  stats,
} from './engine-state.js';
import { createLogger } from './logger.js';

const logger = createLogger('api');

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    });
    res.end();
    return;
  }

  // POST /api/scan — primary endpoint for platform proxy
  // Accepts optional { minSpread, limit } in body
  if (path === '/api/scan' && method === 'POST') {
    const body = await parseBody(req);
    const minSpread = typeof body.minSpread === 'number' ? body.minSpread : 0;
    const limit = typeof body.limit === 'number' ? Math.min(body.limit, 100) : 20;

    const filtered = recentOpportunities
      .filter((opp) => opp.netSpreadCents >= minSpread)
      .slice(0, limit);

    return jsonResponse(res, {
      opportunities: filtered,
      total: filtered.length,
      engine: {
        pairsTracked: stats.pairsTracked,
        uptime: Math.round((Date.now() - new Date(stats.startedAt).getTime()) / 1000),
      },
    });
  }

  // GET /api/opportunities — recent opportunities
  if (path === '/api/opportunities' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    return jsonResponse(res, {
      opportunities: recentOpportunities.slice(0, limit),
      total: recentOpportunities.length,
    });
  }

  // GET /api/pairs — all tracked pairs with current prices
  if (path === '/api/pairs' && method === 'GET') {
    const pairs: unknown[] = [];

    for (const [pairId, prices] of priceCache.entries()) {
      // Find pair metadata
      let meta: { kalshiTitle: string; polyQuestion: string; kalshiTicker: string; polymarketId: string } | null = null;
      for (const refs of kalshiTickerToPairs.values()) {
        const found = refs.find((r) => r.pairId === pairId);
        if (found) {
          meta = {
            kalshiTitle: found.kalshiTitle,
            polyQuestion: found.polyQuestion,
            kalshiTicker: found.kalshiTicker,
            polymarketId: found.polymarketId,
          };
          break;
        }
      }

      pairs.push({
        pairId,
        ...meta,
        prices: {
          kalshiYesBid: prices.kalshiYesBid,
          kalshiYesAsk: prices.kalshiYesAsk,
          kalshiNoBid: prices.kalshiNoBid,
          kalshiNoAsk: prices.kalshiNoAsk,
          polyYesBid: prices.polyYesBid,
          polyYesAsk: prices.polyYesAsk,
        },
      });
    }

    return jsonResponse(res, { pairs, total: pairs.length });
  }

  // GET /api/status — engine health
  if (path === '/api/status' && method === 'GET') {
    const uptimeSeconds = Math.round(
      (Date.now() - new Date(stats.startedAt).getTime()) / 1000
    );

    return jsonResponse(res, {
      status: 'running',
      version: '1.0.0',
      uptime: uptimeSeconds,
      stats: {
        ...stats,
        cacheSize: priceCache.size,
      },
    });
  }

  // Health check
  if (path === '/health') {
    return jsonResponse(res, { status: 'ok' });
  }

  jsonResponse(res, { error: 'Not found', code: 'NOT_FOUND' }, 404);
}

export function startApiServer(port: number) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      logger.error('API error', { error: (err as Error).message });
      jsonResponse(res, { error: 'Internal server error' }, 500);
    });
  });

  server.listen(port, () => {
    logger.info(`API server listening on http://localhost:${port}`);
    logger.info('Platform proxy target: POST /api/scan');
  });

  return server;
}
