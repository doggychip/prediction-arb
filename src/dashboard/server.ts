import http from 'http';
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { createLogger } from '../logger.js';
import { handleApiRequest } from './api.js';
import { DASHBOARD_HTML } from './static.js';

const logger = createLogger('dashboard');

export function startDashboard(
  config: Config,
  db: Database.Database,
  getStats: () => { oppsFound: number; alertsSent: number; suppressed: number; cacheSize: number },
): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${config.dashboardPort}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      handleApiRequest(url, db, getStats, res);
      return;
    }

    // Serve dashboard HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(config.dashboardPort, () => {
    logger.info(`Dashboard running at http://localhost:${config.dashboardPort}`);
  });

  return server;
}
