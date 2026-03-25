import express from 'express';
import cors from 'cors';
import { getDatabase } from './database';
import { up } from './migrations/001_initial';
import { AccountService } from './services/account-service';
import { JournalService } from './services/journal-service';
import { LedgerService } from './services/ledger-service';
import { createAccountRoutes } from './routes/accounts';
import { createJournalRoutes } from './routes/journal';
import { createReportRoutes } from './routes/reports';

const PORT = process.env.PORT || 3000;

const db = getDatabase();
up(db);

const accountService = new AccountService(db);
const journalService = new JournalService(db);
const ledgerService = new LedgerService(db);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/accounts', createAccountRoutes(accountService));
app.use('/api/journal', createJournalRoutes(journalService));
app.use('/api/reports', createReportRoutes(ledgerService));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Finance system running on port ${PORT}`);
});

export { app };
