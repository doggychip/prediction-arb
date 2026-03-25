import { Router, Request, Response } from 'express';
import { JournalService } from '../services/journal-service';
import { CreateJournalEntrySchema } from '../models/validation';
import { validate } from '../middleware/validate';

export function createJournalRoutes(journalService: JournalService): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const { startDate, endDate, posted } = req.query;
    res.json(journalService.list({
      startDate: startDate as string,
      endDate: endDate as string,
      posted: posted !== undefined ? posted === 'true' : undefined,
    }));
  });

  router.get('/:id', (req: Request, res: Response) => {
    const entry = journalService.getById(req.params.id as string);
    if (!entry) { res.status(404).json({ error: 'Journal entry not found' }); return; }
    res.json(entry);
  });

  router.post('/', validate(CreateJournalEntrySchema), (req: Request, res: Response) => {
    try {
      const entry = journalService.create(req.body);
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/:id/post', (req: Request, res: Response) => {
    try {
      const entry = journalService.post(req.params.id as string);
      if (!entry) { res.status(404).json({ error: 'Journal entry not found' }); return; }
      res.json(entry);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/:id/void', (req: Request, res: Response) => {
    try {
      const entry = journalService.void(req.params.id as string);
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const deleted = journalService.delete(req.params.id as string);
      if (!deleted) { res.status(404).json({ error: 'Journal entry not found' }); return; }
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}
