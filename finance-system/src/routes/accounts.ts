import { Router, Request, Response } from 'express';
import { AccountService } from '../services/account-service';
import { CreateAccountSchema, UpdateAccountSchema } from '../models/validation';
import { validate } from '../middleware/validate';

export function createAccountRoutes(accountService: AccountService): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const type = req.query.type as string | undefined;
    res.json(accountService.list(type));
  });

  router.get('/:id', (req: Request, res: Response) => {
    const account = accountService.getById(req.params.id as string);
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    res.json(account);
  });

  router.post('/', validate(CreateAccountSchema), (req: Request, res: Response) => {
    try {
      const account = accountService.create(req.body);
      res.status(201).json(account);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  router.patch('/:id', validate(UpdateAccountSchema), (req: Request, res: Response) => {
    const account = accountService.update(req.params.id as string, req.body);
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }
    res.json(account);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const deleted = accountService.delete(req.params.id as string);
      if (!deleted) { res.status(404).json({ error: 'Account not found' }); return; }
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/:id/children', (req: Request, res: Response) => {
    res.json(accountService.getChildren(req.params.id as string));
  });

  return router;
}
