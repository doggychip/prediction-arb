export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parent_id: string | null;
  description: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  is_posted: number;
  created_at: string;
  updated_at: string;
}

export interface LineItem {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
}

export interface FiscalPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_closed: number;
  created_at: string;
}

export interface JournalEntryWithLines extends JournalEntry {
  lines: LineItem[];
}

export interface AccountBalance {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  debit_total: number;
  credit_total: number;
  balance: number;
}

export interface TrialBalance {
  accounts: AccountBalance[];
  total_debits: number;
  total_credits: number;
  is_balanced: boolean;
}

export interface FinancialStatement {
  title: string;
  as_of: string;
  sections: StatementSection[];
  total: number;
}

export interface StatementSection {
  name: string;
  accounts: AccountBalance[];
  subtotal: number;
}
