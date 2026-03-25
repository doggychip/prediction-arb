import { Router, Request, Response } from 'express';
import { LedgerService } from '../services/ledger-service';

export function createReportRoutes(ledgerService: LedgerService): Router {
  const router = Router();

  router.get('/trial-balance', (req: Request, res: Response) => {
    const asOf = req.query.asOf as string | undefined;
    res.json(ledgerService.getTrialBalance(asOf));
  });

  router.get('/balance-sheet', (req: Request, res: Response) => {
    const asOf = req.query.asOf as string | undefined;
    res.json(ledgerService.getBalanceSheet(asOf));
  });

  router.get('/income-statement', (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate and endDate are required' });
      return;
    }
    res.json(ledgerService.getIncomeStatement(startDate as string, endDate as string));
  });

  router.get('/account/:id/ledger', (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;
    res.json(ledgerService.getAccountLedger(
      req.params.id as string,
      startDate as string,
      endDate as string,
    ));
  });

  router.get('/account/:id/balance', (req: Request, res: Response) => {
    const asOf = req.query.asOf as string | undefined;
    const balance = ledgerService.getAccountBalance(req.params.id as string, asOf);
    if (!balance) { res.status(404).json({ error: 'Account not found' }); return; }
    res.json(balance);
  });

  return router;
}
