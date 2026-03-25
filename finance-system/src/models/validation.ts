import { z } from 'zod';

export const accountTypes = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

export const CreateAccountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  type: z.enum(accountTypes),
  parent_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const UpdateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  is_active: z.number().min(0).max(1).optional(),
});

export const LineItemInput = z.object({
  account_id: z.string().min(1),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  description: z.string().nullable().optional(),
});

export const CreateJournalEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  reference: z.string().nullable().optional(),
  lines: z.array(LineItemInput).min(2),
});

export const CreateFiscalPeriodSchema = z.object({
  name: z.string().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;
export type CreateJournalEntryInput = z.infer<typeof CreateJournalEntrySchema>;
export type CreateFiscalPeriodInput = z.infer<typeof CreateFiscalPeriodSchema>;
