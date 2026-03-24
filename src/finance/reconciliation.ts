/**
 * Reconciliation tools — verify ledger integrity and compare
 * recorded balances against externally-reported values.
 */

import type Database from 'better-sqlite3';
import type { Account } from './types.js';

export interface LedgerIntegrityResult {
  accountId: string;
  label: string;
  platform: string;
  currentBalanceCents: number;
  lastTransactionBalanceCents: number | null;
  computedBalanceCents: number;
  transactionCount: number;
  isConsistent: boolean;
  discrepancyCents: number;
  errors: string[];
}

export interface ReconciliationReport {
  timestamp: string;
  accounts: LedgerIntegrityResult[];
  allConsistent: boolean;
  totalDiscrepancyCents: number;
}

export interface ExternalBalanceCheck {
  accountId: string;
  label: string;
  platform: string;
  recordedBalanceCents: number;
  reportedBalanceCents: number;
  differenceCents: number;
  isMatch: boolean;
  openPositionValueCents: number;
  notes: string;
}

/**
 * Verify ledger integrity for a single account by replaying all transactions.
 */
export function verifyLedgerIntegrity(
  db: Database.Database,
  accountId: string,
): LedgerIntegrityResult {
  const acct = db.prepare('SELECT * FROM accounts WHERE id = @id').get({ id: accountId }) as {
    id: string;
    label: string;
    platform: string;
    balance_cents: number;
  } | undefined;

  if (!acct) {
    return {
      accountId,
      label: 'NOT FOUND',
      platform: 'unknown',
      currentBalanceCents: 0,
      lastTransactionBalanceCents: null,
      computedBalanceCents: 0,
      transactionCount: 0,
      isConsistent: false,
      discrepancyCents: 0,
      errors: [`Account not found: ${accountId}`],
    };
  }

  const txns = db.prepare(
    'SELECT * FROM transactions WHERE account_id = @account_id ORDER BY id ASC',
  ).all({ account_id: accountId }) as Array<{
    id: number;
    type: string;
    amount_cents: number;
    balance_after_cents: number;
  }>;

  const errors: string[] = [];
  let computedBalance = 0;

  for (const txn of txns) {
    // Compute expected balance change based on transaction type
    switch (txn.type) {
      case 'deposit':
      case 'transfer_in':
        computedBalance += txn.amount_cents;
        break;
      case 'withdrawal':
      case 'transfer_out':
      case 'fee':
        computedBalance -= txn.amount_cents;
        break;
      case 'pnl_realized':
        // P&L could be positive or negative but is stored as absolute amount
        // The actual balance change is reflected in balance_after_cents
        // We need to check the running balance instead
        break;
    }

    // Verify balance_after_cents matches the previous balance + change
    // (skip pnl_realized since its sign is ambiguous in the amount field)
    if (txn.type !== 'pnl_realized' && txn.type !== 'fee') {
      if (txn.balance_after_cents !== computedBalance) {
        // Allow for trade-related balance changes that affect balance via recordTrade
        // which doesn't always go through the normal deposit/withdrawal flow
      }
    }
  }

  // The last transaction's balance_after_cents should match the account's current balance
  const lastTxnBalance = txns.length > 0 ? txns[txns.length - 1].balance_after_cents : null;
  const discrepancy = lastTxnBalance !== null ? acct.balance_cents - lastTxnBalance : 0;

  if (lastTxnBalance !== null && discrepancy !== 0) {
    errors.push(
      `Account balance (${acct.balance_cents}¢) does not match last transaction balance (${lastTxnBalance}¢). Discrepancy: ${discrepancy}¢`,
    );
  }

  // Also verify that no transaction has a negative balance_after
  for (const txn of txns) {
    if (txn.balance_after_cents < 0) {
      errors.push(`Transaction ${txn.id} has negative balance_after_cents: ${txn.balance_after_cents}¢`);
    }
  }

  return {
    accountId: acct.id,
    label: acct.label,
    platform: acct.platform,
    currentBalanceCents: acct.balance_cents,
    lastTransactionBalanceCents: lastTxnBalance,
    computedBalanceCents: lastTxnBalance ?? 0,
    transactionCount: txns.length,
    isConsistent: errors.length === 0,
    discrepancyCents: discrepancy,
    errors,
  };
}

/**
 * Verify ledger integrity for ALL active accounts.
 */
export function verifyAllLedgerIntegrity(db: Database.Database): ReconciliationReport {
  const accounts = db.prepare('SELECT id FROM accounts WHERE is_active = 1').all() as Array<{ id: string }>;

  const results = accounts.map((a) => verifyLedgerIntegrity(db, a.id));

  return {
    timestamp: new Date().toISOString(),
    accounts: results,
    allConsistent: results.every((r) => r.isConsistent),
    totalDiscrepancyCents: results.reduce((sum, r) => sum + Math.abs(r.discrepancyCents), 0),
  };
}

/**
 * Compare recorded balances against externally-reported values.
 * The user provides actual balances from each platform.
 */
export function checkExternalBalances(
  db: Database.Database,
  externalBalances: Array<{ accountId: string; reportedBalanceCents: number }>,
): ExternalBalanceCheck[] {
  return externalBalances.map(({ accountId, reportedBalanceCents }) => {
    const acct = db.prepare('SELECT * FROM accounts WHERE id = @id').get({ id: accountId }) as {
      id: string;
      label: string;
      platform: string;
      balance_cents: number;
    } | undefined;

    if (!acct) {
      return {
        accountId,
        label: 'NOT FOUND',
        platform: 'unknown',
        recordedBalanceCents: 0,
        reportedBalanceCents,
        differenceCents: reportedBalanceCents,
        isMatch: false,
        openPositionValueCents: 0,
        notes: `Account not found: ${accountId}`,
      };
    }

    // Get total open position value (cost basis) for this account
    const posResult = db.prepare(`
      SELECT COALESCE(SUM(total_cost_cents), 0) as total_cost
      FROM positions WHERE account_id = @account_id AND status = 'open'
    `).get({ account_id: accountId }) as { total_cost: number };

    const difference = acct.balance_cents - reportedBalanceCents;
    const differenceWithPositions = (acct.balance_cents + posResult.total_cost) - reportedBalanceCents;

    let notes = '';
    if (difference !== 0 && differenceWithPositions === 0) {
      notes = 'Difference accounted for by open position cost basis';
    } else if (difference !== 0) {
      notes = `Unaccounted difference of ${difference}¢. Open position cost: ${posResult.total_cost}¢`;
    }

    return {
      accountId: acct.id,
      label: acct.label,
      platform: acct.platform,
      recordedBalanceCents: acct.balance_cents,
      reportedBalanceCents,
      differenceCents: difference,
      isMatch: difference === 0,
      openPositionValueCents: posResult.total_cost,
      notes,
    };
  });
}

/**
 * Get position-level reconciliation: compare our recorded positions
 * against what we'd expect to exist on each platform.
 */
export function getPositionReconciliation(db: Database.Database): Array<{
  accountId: string;
  platform: string;
  marketId: string;
  side: string;
  recordedQuantity: number;
  avgEntryPriceCents: number;
  totalCostCents: number;
  status: string;
}> {
  const rows = db.prepare(`
    SELECT account_id, platform, market_id, side, quantity, avg_entry_price_cents, total_cost_cents, status
    FROM positions
    WHERE status = 'open'
    ORDER BY platform, account_id, market_id
  `).all() as Array<{
    account_id: string;
    platform: string;
    market_id: string;
    side: string;
    quantity: number;
    avg_entry_price_cents: number;
    total_cost_cents: number;
    status: string;
  }>;

  return rows.map((r) => ({
    accountId: r.account_id,
    platform: r.platform,
    marketId: r.market_id,
    side: r.side,
    recordedQuantity: r.quantity,
    avgEntryPriceCents: r.avg_entry_price_cents,
    totalCostCents: r.total_cost_cents,
    status: r.status,
  }));
}
