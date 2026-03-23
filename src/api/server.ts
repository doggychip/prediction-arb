import express from 'express';
import type { Server } from 'http';
import type Database from 'better-sqlite3';
import { createFinanceRouter } from './routes.js';
import { createLogger } from '../logger.js';

const logger = createLogger('api');

export function startApiServer(db: Database.Database, port: number): Server {
  const app = express();

  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Finance API routes
  app.use('/api', createFinanceRouter(db));

  const server = app.listen(port, () => {
    logger.info(`Finance API listening on port ${port}`);
  });

  return server;
}
