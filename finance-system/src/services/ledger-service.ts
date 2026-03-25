import Database from 'better-sqlite3';
import { AccountBalance, AccountType, TrialBalance, FinancialStatement, StatementSection } from '../models/types';

export class LedgerService {
  constructor(private db: Database.Database) {}

  getAccountBalance(accountId: string, asOf?: string): AccountBalance | undefined {
    let query = `
      SELECT
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.type as account_type,
        COALESCE(SUM(li.debit), 0) as debit_total,
        COALESCE(SUM(li.credit), 0) as credit_total
      FROM accounts a
      LEFT JOIN line_items li ON a.id = li.account_id
      LEFT JOIN journal_entries je ON li.journal_entry_id = je.id AND je.is_posted = 1
    `;
    const params: any[] = [accountId];

    if (asOf) {
      query += ' AND je.date <= ?';
      params.push(asOf);
    }

    query += ' WHERE a.id = ? GROUP BY a.id';
    // account_id param needs to be last since WHERE comes after JOIN conditions
    // Restructure:
    const finalQuery = `
      SELECT
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.type as account_type,
        COALESCE(SUM(li.debit), 0) as debit_total,
        COALESCE(SUM(li.credit), 0) as credit_total
      FROM accounts a
      LEFT JOIN (
        line_items li
        INNER JOIN journal_entries je ON li.journal_entry_id = je.id AND je.is_posted = 1
          ${asOf ? 'AND je.date <= ?' : ''}
      ) ON a.id = li.account_id
      WHERE a.id = ?
      GROUP BY a.id
    `;

    const finalParams = asOf ? [asOf, accountId] : [accountId];
    const row = this.db.prepare(finalQuery).get(...finalParams) as any;
    if (!row) return undefined;

    return {
      ...row,
      balance: this.calculateBalance(row.account_type, row.debit_total, row.credit_total),
    };
  }

  getTrialBalance(asOf?: string): TrialBalance {
    const query = `
      SELECT
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.type as account_type,
        COALESCE(SUM(li.debit), 0) as debit_total,
        COALESCE(SUM(li.credit), 0) as credit_total
      FROM accounts a
      LEFT JOIN (
        line_items li
        INNER JOIN journal_entries je ON li.journal_entry_id = je.id AND je.is_posted = 1
          ${asOf ? 'AND je.date <= ?' : ''}
      ) ON a.id = li.account_id
      WHERE a.is_active = 1
      GROUP BY a.id
      HAVING debit_total > 0 OR credit_total > 0
      ORDER BY a.code
    `;

    const params = asOf ? [asOf] : [];
    const rows = this.db.prepare(query).all(...params) as any[];

    const accounts: AccountBalance[] = rows.map(row => ({
      ...row,
      balance: this.calculateBalance(row.account_type, row.debit_total, row.credit_total),
    }));

    const totalDebits = accounts.reduce((sum, a) => sum + a.debit_total, 0);
    const totalCredits = accounts.reduce((sum, a) => sum + a.credit_total, 0);

    return {
      accounts,
      total_debits: totalDebits,
      total_credits: totalCredits,
      is_balanced: Math.abs(totalDebits - totalCredits) < 0.01,
    };
  }

  getBalanceSheet(asOf?: string): FinancialStatement {
    const date = asOf || new Date().toISOString().split('T')[0];
    const allBalances = this.getAllBalances(date);

    const assets = this.buildSection('Assets', allBalances, 'asset');
    const liabilities = this.buildSection('Liabilities', allBalances, 'liability');
    const equity = this.buildSection('Equity', allBalances, 'equity');

    return {
      title: 'Balance Sheet',
      as_of: date,
      sections: [assets, liabilities, equity],
      total: assets.subtotal - liabilities.subtotal - equity.subtotal,
    };
  }

  getIncomeStatement(startDate: string, endDate: string): FinancialStatement {
    const allBalances = this.getPeriodBalances(startDate, endDate);

    const revenue = this.buildSection('Revenue', allBalances, 'revenue');
    const expenses = this.buildSection('Expenses', allBalances, 'expense');
    const netIncome = revenue.subtotal - expenses.subtotal;

    return {
      title: 'Income Statement',
      as_of: `${startDate} to ${endDate}`,
      sections: [revenue, expenses],
      total: netIncome,
    };
  }

  getAccountLedger(accountId: string, startDate?: string, endDate?: string) {
    let query = `
      SELECT
        je.date,
        je.description as entry_description,
        je.reference,
        li.debit,
        li.credit,
        li.description as line_description
      FROM line_items li
      JOIN journal_entries je ON li.journal_entry_id = je.id
      WHERE li.account_id = ? AND je.is_posted = 1
    `;
    const params: any[] = [accountId];

    if (startDate) { query += ' AND je.date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND je.date <= ?'; params.push(endDate); }

    query += ' ORDER BY je.date, je.created_at';

    return this.db.prepare(query).all(...params);
  }

  private getAllBalances(asOf: string): AccountBalance[] {
    const query = `
      SELECT
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.type as account_type,
        COALESCE(SUM(li.debit), 0) as debit_total,
        COALESCE(SUM(li.credit), 0) as credit_total
      FROM accounts a
      LEFT JOIN (
        line_items li
        INNER JOIN journal_entries je ON li.journal_entry_id = je.id AND je.is_posted = 1 AND je.date <= ?
      ) ON a.id = li.account_id
      WHERE a.is_active = 1
      GROUP BY a.id
      ORDER BY a.code
    `;

    return (this.db.prepare(query).all(asOf) as any[]).map(row => ({
      ...row,
      balance: this.calculateBalance(row.account_type, row.debit_total, row.credit_total),
    }));
  }

  private getPeriodBalances(startDate: string, endDate: string): AccountBalance[] {
    const query = `
      SELECT
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.type as account_type,
        COALESCE(SUM(li.debit), 0) as debit_total,
        COALESCE(SUM(li.credit), 0) as credit_total
      FROM accounts a
      LEFT JOIN (
        line_items li
        INNER JOIN journal_entries je ON li.journal_entry_id = je.id AND je.is_posted = 1
          AND je.date >= ? AND je.date <= ?
      ) ON a.id = li.account_id
      WHERE a.is_active = 1
      GROUP BY a.id
      ORDER BY a.code
    `;

    return (this.db.prepare(query).all(startDate, endDate) as any[]).map(row => ({
      ...row,
      balance: this.calculateBalance(row.account_type, row.debit_total, row.credit_total),
    }));
  }

  private buildSection(name: string, balances: AccountBalance[], type: AccountType): StatementSection {
    const accounts = balances.filter(b => b.account_type === type && (b.debit_total > 0 || b.credit_total > 0));
    const subtotal = accounts.reduce((sum, a) => sum + Math.abs(a.balance), 0);
    return { name, accounts, subtotal };
  }

  private calculateBalance(type: AccountType, debits: number, credits: number): number {
    // Assets and expenses have normal debit balances
    // Liabilities, equity, and revenue have normal credit balances
    if (type === 'asset' || type === 'expense') {
      return debits - credits;
    }
    return credits - debits;
  }
}
