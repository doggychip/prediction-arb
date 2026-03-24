import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Server } from 'http';
import type Database from 'better-sqlite3';
import { createFinanceRouter } from './routes.js';
import { createLogger } from '../logger.js';

const logger = createLogger('api');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startApiServer(db: Database.Database, port: number): Server {
  const app = express();

  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Finance API routes
  app.use('/api', createFinanceRouter(db));

  // Serve dashboard UI
  const publicDir = path.resolve(__dirname, '../../public');
  app.use(express.static(publicDir));

  // Fallback: serve index.html for the root
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const server = app.listen(port, () => {
    logger.info(`Finance API listening on port ${port}`);
    logger.info(`Dashboard available at http://localhost:${port}/`);
  });

  return server;
}
