import Database from 'better-sqlite3';
import { up } from '../migrations/001_initial';
import { AccountService } from './account-service';
import { JournalService } from './journal-service';
import { LedgerService } from './ledger-service';

let db: Database.Database;
let accounts: AccountService;
let journal: JournalService;
let ledger: LedgerService;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  up(db);
  accounts = new AccountService(db);
  journal = new JournalService(db);
  ledger = new LedgerService(db);
});

afterEach(() => {
  db.close();
});

describe('AccountService', () => {
  test('creates and retrieves an account', () => {
    const account = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    expect(account.code).toBe('1000');
    expect(account.name).toBe('Cash');
    expect(account.type).toBe('asset');

    const retrieved = accounts.getById(account.id);
    expect(retrieved).toEqual(account);
  });

  test('lists accounts by type', () => {
    accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    accounts.create({ code: '2000', name: 'Accounts Payable', type: 'liability' });

    const assets = accounts.list('asset');
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe('Cash');
  });

  test('updates an account', () => {
    const account = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const updated = accounts.update(account.id, { name: 'Cash & Equivalents' });
    expect(updated!.name).toBe('Cash & Equivalents');
  });

  test('prevents deleting account with transactions', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Revenue', type: 'revenue' });

    journal.create({
      date: '2026-01-01',
      description: 'Sale',
      lines: [
        { account_id: cash.id, debit: 100, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100 },
      ],
    });

    expect(() => accounts.delete(cash.id)).toThrow('Cannot delete account with existing transactions');
  });
});

describe('JournalService', () => {
  test('creates a balanced journal entry', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Revenue', type: 'revenue' });

    const entry = journal.create({
      date: '2026-01-15',
      description: 'Cash sale',
      lines: [
        { account_id: cash.id, debit: 500, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 500 },
      ],
    });

    expect(entry.lines).toHaveLength(2);
    expect(entry.is_posted).toBe(0);
  });

  test('rejects unbalanced entries', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Revenue', type: 'revenue' });

    expect(() => journal.create({
      date: '2026-01-15',
      description: 'Bad entry',
      lines: [
        { account_id: cash.id, debit: 500, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 300 },
      ],
    })).toThrow('Entry is not balanced');
  });

  test('posts and prevents re-posting', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Revenue', type: 'revenue' });

    const entry = journal.create({
      date: '2026-01-15',
      description: 'Sale',
      lines: [
        { account_id: cash.id, debit: 100, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100 },
      ],
    });

    const posted = journal.post(entry.id);
    expect(posted!.is_posted).toBe(1);
    expect(() => journal.post(entry.id)).toThrow('already posted');
  });

  test('voids an entry with reversing entry', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Revenue', type: 'revenue' });

    const entry = journal.create({
      date: '2026-01-15',
      description: 'Sale',
      lines: [
        { account_id: cash.id, debit: 100, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100 },
      ],
    });

    const voided = journal.void(entry.id);
    expect(voided.description).toContain('Void');
    // Reversing entry should have opposite debits/credits
    const cashLine = voided.lines.find(l => l.account_id === cash.id)!;
    expect(cashLine.credit).toBe(100);
    expect(cashLine.debit).toBe(0);
  });

  test('prevents deleting posted entries', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Revenue', type: 'revenue' });

    const entry = journal.create({
      date: '2026-01-15',
      description: 'Sale',
      lines: [
        { account_id: cash.id, debit: 100, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100 },
      ],
    });

    journal.post(entry.id);
    expect(() => journal.delete(entry.id)).toThrow('Cannot delete a posted entry');
  });
});

describe('LedgerService', () => {
  test('calculates account balance correctly', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Revenue', type: 'revenue' });

    const entry = journal.create({
      date: '2026-01-15',
      description: 'Sale',
      lines: [
        { account_id: cash.id, debit: 1000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 1000 },
      ],
    });
    journal.post(entry.id);

    const cashBalance = ledger.getAccountBalance(cash.id);
    expect(cashBalance!.balance).toBe(1000); // debit balance for asset

    const revenueBalance = ledger.getAccountBalance(revenue.id);
    expect(revenueBalance!.balance).toBe(1000); // credit balance for revenue
  });

  test('generates balanced trial balance', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Revenue', type: 'revenue' });
    const expense = accounts.create({ code: '5000', name: 'Rent', type: 'expense' });

    const e1 = journal.create({
      date: '2026-01-15',
      description: 'Sale',
      lines: [
        { account_id: cash.id, debit: 1000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 1000 },
      ],
    });
    journal.post(e1.id);

    const e2 = journal.create({
      date: '2026-01-20',
      description: 'Rent payment',
      lines: [
        { account_id: expense.id, debit: 300, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 300 },
      ],
    });
    journal.post(e2.id);

    const tb = ledger.getTrialBalance();
    expect(tb.is_balanced).toBe(true);
    expect(tb.total_debits).toBe(1300);
    expect(tb.total_credits).toBe(1300);
  });

  test('generates balance sheet', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const equity = accounts.create({ code: '3000', name: 'Owner Equity', type: 'equity' });

    const entry = journal.create({
      date: '2026-01-01',
      description: 'Owner investment',
      lines: [
        { account_id: cash.id, debit: 5000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 5000 },
      ],
    });
    journal.post(entry.id);

    const bs = ledger.getBalanceSheet('2026-01-31');
    expect(bs.sections[0].name).toBe('Assets');
    expect(bs.sections[0].subtotal).toBe(5000);
    expect(bs.sections[2].name).toBe('Equity');
    expect(bs.sections[2].subtotal).toBe(5000);
  });

  test('generates income statement', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Sales', type: 'revenue' });
    const expense = accounts.create({ code: '5000', name: 'COGS', type: 'expense' });

    const e1 = journal.create({
      date: '2026-01-15',
      description: 'Sale',
      lines: [
        { account_id: cash.id, debit: 1000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 1000 },
      ],
    });
    journal.post(e1.id);

    const e2 = journal.create({
      date: '2026-01-15',
      description: 'Cost of goods',
      lines: [
        { account_id: expense.id, debit: 400, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 400 },
      ],
    });
    journal.post(e2.id);

    const is = ledger.getIncomeStatement('2026-01-01', '2026-01-31');
    expect(is.total).toBe(600); // net income = 1000 - 400
  });

  test('only includes posted entries in balances', () => {
    const cash = accounts.create({ code: '1000', name: 'Cash', type: 'asset' });
    const revenue = accounts.create({ code: '4000', name: 'Revenue', type: 'revenue' });

    // Unposted entry
    journal.create({
      date: '2026-01-15',
      description: 'Draft sale',
      lines: [
        { account_id: cash.id, debit: 1000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 1000 },
      ],
    });

    const balance = ledger.getAccountBalance(cash.id);
    expect(balance!.balance).toBe(0); // Should be 0 since not posted
  });
});
