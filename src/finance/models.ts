import type Database from 'better-sqlite3';
import type {
  Account,
  Transaction,
  Position,
  Trade,
  BalanceSnapshot,
  CreateAccountInput,
  RecordDepositInput,
  RecordWithdrawalInput,
  RecordTransferInput,
  RecordTradeInput,
  BalanceSummary,
  PnLSummary,
  PositionMtm,
  UnrealizedPnLReport,
  DailySummary,
  FeeBreakdown,
} from './types.js';
import { getCurrentMarketPrice } from './prices.js';

// ── Row types (snake_case as stored in SQLite) ─────────────────────

interface AccountRow {
  id: string;
  platform: string;
  label: string;
  balance_cents: number;
  currency: string;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface TransactionRow {
  id: number;
  account_id: string;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  related_transaction_id: number | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

interface PositionRow {
  id: number;
  account_id: string;
  platform: string;
  market_id: string;
  side: string;
  quantity: number;
  avg_entry_price_cents: number;
  total_cost_cents: number;
  status: string;
  pair_id: string | null;
  opened_at: string;
  closed_at: string | null;
  updated_at: string;
}

interface TradeRow {
  id: number;
  position_id: number | null;
  account_id: string;
  platform: string;
  market_id: string;
  side: string;
  direction: string;
  quantity: number;
  price_cents: number;
  total_cents: number;
  fee_cents: number;
  realized_pnl_cents: number | null;
  pair_id: string | null;
  external_id: string | null;
  notes: string | null;
  executed_at: string;
}

interface BalanceSnapshotRow {
  id: number;
  account_id: string;
  balance_cents: number;
  unrealized_pnl_cents: number;
  timestamp: string;
}

// ── Row → domain converters ────────────────────────────────────────

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    platform: row.platform as Account['platform'],
    label: row.label,
    balanceCents: row.balance_cents,
    currency: row.currency,
    isActive: row.is_active === 1,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type as Transaction['type'],
    amountCents: row.amount_cents,
    balanceAfterCents: row.balance_after_cents,
    relatedTransactionId: row.related_transaction_id ?? undefined,
    reference: row.reference ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
  };
}

function toPosition(row: PositionRow): Position {
  return {
    id: row.id,
    accountId: row.account_id,
    platform: row.platform as Position['platform'],
    marketId: row.market_id,
    side: row.side as Position['side'],
    quantity: row.quantity,
    avgEntryPriceCents: row.avg_entry_price_cents,
    totalCostCents: row.total_cost_cents,
    status: row.status as Position['status'],
    pairId: row.pair_id ?? undefined,
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function toTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    positionId: row.position_id ?? undefined,
    accountId: row.account_id,
    platform: row.platform as Trade['platform'],
    marketId: row.market_id,
    side: row.side as Trade['side'],
    direction: row.direction as Trade['direction'],
    quantity: row.quantity,
    priceCents: row.price_cents,
    totalCents: row.total_cents,
    feeCents: row.fee_cents,
    realizedPnlCents: row.realized_pnl_cents ?? undefined,
    pairId: row.pair_id ?? undefined,
    externalId: row.external_id ?? undefined,
    notes: row.notes ?? undefined,
    executedAt: row.executed_at,
  };
}

function toBalanceSnapshot(row: BalanceSnapshotRow): BalanceSnapshot {
  return {
    id: row.id,
    accountId: row.account_id,
    balanceCents: row.balance_cents,
    unrealizedPnlCents: row.unrealized_pnl_cents,
    timestamp: row.timestamp,
  };
}

// ── Account management ─────────────────────────────────────────────

export function createAccount(db: Database.Database, input: CreateAccountInput): Account {
  const initialBalance = input.initialBalanceCents ?? 0;

  const doCreate = db.transaction(() => {
    db.prepare(`
      INSERT INTO accounts (id, platform, label, balance_cents, currency, notes)
      VALUES (@id, @platform, @label, @balance_cents, @currency, @notes)
    `).run({
      id: input.id,
      platform: input.platform,
      label: input.label,
      balance_cents: initialBalance,
      currency: input.currency ?? 'USD',
      notes: input.notes ?? null,
    });

    if (initialBalance > 0) {
      db.prepare(`
        INSERT INTO transactions (account_id, type, amount_cents, balance_after_cents, notes)
        VALUES (@account_id, 'deposit', @amount_cents, @balance_after_cents, 'Initial deposit')
      `).run({
        account_id: input.id,
        amount_cents: initialBalance,
        balance_after_cents: initialBalance,
      });
    }
  });

  doCreate();
  return getAccount(db, input.id)!;
}

export function getAccount(db: Database.Database, accountId: string): Account | undefined {
  const row = db.prepare('SELECT * FROM accounts WHERE id = @id').get({ id: accountId }) as AccountRow | undefined;
  return row ? toAccount(row) : undefined;
}

export function getAllAccounts(db: Database.Database): Account[] {
  const rows = db.prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY platform, label').all() as AccountRow[];
  return rows.map(toAccount);
}

export function deactivateAccount(db: Database.Database, accountId: string): void {
  db.prepare("UPDATE accounts SET is_active = 0, updated_at = datetime('now') WHERE id = @id").run({ id: accountId });
}

// ── Fund flow operations ───────────────────────────────────────────

export function recordDeposit(db: Database.Database, input: RecordDepositInput): Transaction {
  if (input.amountCents <= 0) throw new Error('Deposit amount must be positive');

  let txnId = 0;

  const doDeposit = db.transaction(() => {
    const acct = db.prepare('SELECT balance_cents FROM accounts WHERE id = @id').get({ id: input.accountId }) as { balance_cents: number } | undefined;
    if (!acct) throw new Error(`Account not found: ${input.accountId}`);

    const newBalance = acct.balance_cents + input.amountCents;

    const result = db.prepare(`
      INSERT INTO transactions (account_id, type, amount_cents, balance_after_cents, reference, notes)
      VALUES (@account_id, 'deposit', @amount_cents, @balance_after_cents, @reference, @notes)
    `).run({
      account_id: input.accountId,
      amount_cents: input.amountCents,
      balance_after_cents: newBalance,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });

    db.prepare("UPDATE accounts SET balance_cents = @balance, updated_at = datetime('now') WHERE id = @id").run({
      balance: newBalance,
      id: input.accountId,
    });

    txnId = Number(result.lastInsertRowid);
  });

  doDeposit();
  return getTransactionById(db, txnId)!;
}

export function recordWithdrawal(db: Database.Database, input: RecordWithdrawalInput): Transaction {
  if (input.amountCents <= 0) throw new Error('Withdrawal amount must be positive');

  let txnId = 0;

  const doWithdrawal = db.transaction(() => {
    const acct = db.prepare('SELECT balance_cents FROM accounts WHERE id = @id').get({ id: input.accountId }) as { balance_cents: number } | undefined;
    if (!acct) throw new Error(`Account not found: ${input.accountId}`);
    if (acct.balance_cents < input.amountCents) {
      throw new Error(`Insufficient balance: have ${acct.balance_cents}¢, need ${input.amountCents}¢`);
    }

    const newBalance = acct.balance_cents - input.amountCents;

    const result = db.prepare(`
      INSERT INTO transactions (account_id, type, amount_cents, balance_after_cents, reference, notes)
      VALUES (@account_id, 'withdrawal', @amount_cents, @balance_after_cents, @reference, @notes)
    `).run({
      account_id: input.accountId,
      amount_cents: input.amountCents,
      balance_after_cents: newBalance,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });

    db.prepare("UPDATE accounts SET balance_cents = @balance, updated_at = datetime('now') WHERE id = @id").run({
      balance: newBalance,
      id: input.accountId,
    });

    txnId = Number(result.lastInsertRowid);
  });

  doWithdrawal();
  return getTransactionById(db, txnId)!;
}

export function recordTransfer(
  db: Database.Database,
  input: RecordTransferInput,
): { outTxn: Transaction; inTxn: Transaction } {
  if (input.amountCents <= 0) throw new Error('Transfer amount must be positive');
  if (input.fromAccountId === input.toAccountId) throw new Error('Cannot transfer to same account');

  let outTxnId = 0;
  let inTxnId = 0;

  const doTransfer = db.transaction(() => {
    const fromAcct = db.prepare('SELECT balance_cents FROM accounts WHERE id = @id').get({ id: input.fromAccountId }) as { balance_cents: number } | undefined;
    if (!fromAcct) throw new Error(`Source account not found: ${input.fromAccountId}`);
    if (fromAcct.balance_cents < input.amountCents) {
      throw new Error(`Insufficient balance in ${input.fromAccountId}: have ${fromAcct.balance_cents}¢, need ${input.amountCents}¢`);
    }

    const toAcct = db.prepare('SELECT balance_cents FROM accounts WHERE id = @id').get({ id: input.toAccountId }) as { balance_cents: number } | undefined;
    if (!toAcct) throw new Error(`Destination account not found: ${input.toAccountId}`);

    const newFromBalance = fromAcct.balance_cents - input.amountCents;
    const newToBalance = toAcct.balance_cents + input.amountCents;

    // Insert transfer_out
    const outResult = db.prepare(`
      INSERT INTO transactions (account_id, type, amount_cents, balance_after_cents, reference, notes)
      VALUES (@account_id, 'transfer_out', @amount_cents, @balance_after_cents, @reference, @notes)
    `).run({
      account_id: input.fromAccountId,
      amount_cents: input.amountCents,
      balance_after_cents: newFromBalance,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });
    outTxnId = Number(outResult.lastInsertRowid);

    // Insert transfer_in
    const inResult = db.prepare(`
      INSERT INTO transactions (account_id, type, amount_cents, balance_after_cents, related_transaction_id, reference, notes)
      VALUES (@account_id, 'transfer_in', @amount_cents, @balance_after_cents, @related_transaction_id, @reference, @notes)
    `).run({
      account_id: input.toAccountId,
      amount_cents: input.amountCents,
      balance_after_cents: newToBalance,
      related_transaction_id: outTxnId,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });
    inTxnId = Number(inResult.lastInsertRowid);

    // Link the out txn back to the in txn
    db.prepare('UPDATE transactions SET related_transaction_id = @related WHERE id = @id').run({
      related: inTxnId,
      id: outTxnId,
    });

    // Update both account balances
    db.prepare("UPDATE accounts SET balance_cents = @balance, updated_at = datetime('now') WHERE id = @id").run({
      balance: newFromBalance,
      id: input.fromAccountId,
    });
    db.prepare("UPDATE accounts SET balance_cents = @balance, updated_at = datetime('now') WHERE id = @id").run({
      balance: newToBalance,
      id: input.toAccountId,
    });
  });

  doTransfer();
  return {
    outTxn: getTransactionById(db, outTxnId)!,
    inTxn: getTransactionById(db, inTxnId)!,
  };
}

// ── Transaction queries ────────────────────────────────────────────

function getTransactionById(db: Database.Database, id: number): Transaction | undefined {
  const row = db.prepare('SELECT * FROM transactions WHERE id = @id').get({ id }) as TransactionRow | undefined;
  return row ? toTransaction(row) : undefined;
}

export function getTransactions(db: Database.Database, accountId: string, limit = 100): Transaction[] {
  const rows = db.prepare(
    'SELECT * FROM transactions WHERE account_id = @account_id ORDER BY created_at DESC LIMIT @limit',
  ).all({ account_id: accountId, limit }) as TransactionRow[];
  return rows.map(toTransaction);
}

export function getTransactionsByDateRange(
  db: Database.Database,
  accountId: string,
  start: string,
  end: string,
): Transaction[] {
  const rows = db.prepare(`
    SELECT * FROM transactions
    WHERE account_id = @account_id AND created_at >= @start AND created_at <= @end
    ORDER BY created_at ASC
  `).all({ account_id: accountId, start, end }) as TransactionRow[];
  return rows.map(toTransaction);
}

// ── Position management ────────────────────────────────────────────

export function getOpenPositions(db: Database.Database, accountId?: string): Position[] {
  if (accountId) {
    const rows = db.prepare(
      "SELECT * FROM positions WHERE status = 'open' AND account_id = @account_id ORDER BY opened_at DESC",
    ).all({ account_id: accountId }) as PositionRow[];
    return rows.map(toPosition);
  }
  const rows = db.prepare("SELECT * FROM positions WHERE status = 'open' ORDER BY opened_at DESC").all() as PositionRow[];
  return rows.map(toPosition);
}

export function getPositionsByPair(db: Database.Database, pairId: string): Position[] {
  const rows = db.prepare(
    'SELECT * FROM positions WHERE pair_id = @pair_id ORDER BY opened_at DESC',
  ).all({ pair_id: pairId }) as PositionRow[];
  return rows.map(toPosition);
}

export function closePosition(db: Database.Database, positionId: number): void {
  db.prepare(`
    UPDATE positions SET status = 'closed', closed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = @id
  `).run({ id: positionId });
}

// ── Trade recording ────────────────────────────────────────────────

export function recordTrade(db: Database.Database, input: RecordTradeInput): Trade {
  if (input.quantity <= 0) throw new Error('Trade quantity must be positive');
  if (input.priceCents < 0) throw new Error('Trade price must be non-negative');

  const totalCents = input.quantity * input.priceCents;
  const feeCents = input.feeCents ?? 0;
  let tradeId = 0;

  const doTrade = db.transaction(() => {
    // Verify account exists
    const acct = db.prepare('SELECT balance_cents FROM accounts WHERE id = @id').get({ id: input.accountId }) as { balance_cents: number } | undefined;
    if (!acct) throw new Error(`Account not found: ${input.accountId}`);

    let positionId: number | null = null;
    let realizedPnl: number | null = null;
    let balanceChange = 0;

    if (input.direction === 'buy') {
      // Deduct cost from account
      balanceChange = -(totalCents + feeCents);

      // Find or create open position
      const existingPos = db.prepare(`
        SELECT * FROM positions
        WHERE account_id = @account_id AND market_id = @market_id AND side = @side AND status = 'open'
      `).get({
        account_id: input.accountId,
        market_id: input.marketId,
        side: input.side,
      }) as PositionRow | undefined;

      if (existingPos) {
        // Update existing position with weighted average
        const newQty = existingPos.quantity + input.quantity;
        const newTotalCost = existingPos.total_cost_cents + totalCents;
        const newAvgPrice = Math.round(newTotalCost / newQty);

        db.prepare(`
          UPDATE positions
          SET quantity = @quantity, avg_entry_price_cents = @avg_price,
              total_cost_cents = @total_cost, updated_at = datetime('now')
          WHERE id = @id
        `).run({
          quantity: newQty,
          avg_price: newAvgPrice,
          total_cost: newTotalCost,
          id: existingPos.id,
        });
        positionId = existingPos.id;
      } else {
        // Create new position
        const posResult = db.prepare(`
          INSERT INTO positions (account_id, platform, market_id, side, quantity, avg_entry_price_cents, total_cost_cents, pair_id)
          VALUES (@account_id, @platform, @market_id, @side, @quantity, @avg_price, @total_cost, @pair_id)
        `).run({
          account_id: input.accountId,
          platform: input.platform,
          market_id: input.marketId,
          side: input.side,
          quantity: input.quantity,
          avg_price: input.priceCents,
          total_cost: totalCents,
          pair_id: input.pairId ?? null,
        });
        positionId = Number(posResult.lastInsertRowid);
      }
    } else {
      // sell: credit proceeds to account, compute realized P&L
      balanceChange = totalCents - feeCents;

      const existingPos = db.prepare(`
        SELECT * FROM positions
        WHERE account_id = @account_id AND market_id = @market_id AND side = @side AND status = 'open'
      `).get({
        account_id: input.accountId,
        market_id: input.marketId,
        side: input.side,
      }) as PositionRow | undefined;

      if (existingPos) {
        realizedPnl = (input.priceCents - existingPos.avg_entry_price_cents) * input.quantity;
        positionId = existingPos.id;

        const newQty = existingPos.quantity - input.quantity;
        if (newQty <= 0) {
          // Close position
          db.prepare(`
            UPDATE positions SET quantity = 0, status = 'closed',
              closed_at = datetime('now'), updated_at = datetime('now')
            WHERE id = @id
          `).run({ id: existingPos.id });
        } else {
          // Reduce position
          const newTotalCost = existingPos.avg_entry_price_cents * newQty;
          db.prepare(`
            UPDATE positions SET quantity = @quantity, total_cost_cents = @total_cost,
              updated_at = datetime('now')
            WHERE id = @id
          `).run({ quantity: newQty, total_cost: newTotalCost, id: existingPos.id });
        }
      }
    }

    // Insert trade row
    const tradeResult = db.prepare(`
      INSERT INTO trades (
        position_id, account_id, platform, market_id, side, direction,
        quantity, price_cents, total_cents, fee_cents, realized_pnl_cents,
        pair_id, external_id, notes
      ) VALUES (
        @position_id, @account_id, @platform, @market_id, @side, @direction,
        @quantity, @price_cents, @total_cents, @fee_cents, @realized_pnl_cents,
        @pair_id, @external_id, @notes
      )
    `).run({
      position_id: positionId,
      account_id: input.accountId,
      platform: input.platform,
      market_id: input.marketId,
      side: input.side,
      direction: input.direction,
      quantity: input.quantity,
      price_cents: input.priceCents,
      total_cents: totalCents,
      fee_cents: feeCents,
      realized_pnl_cents: realizedPnl,
      pair_id: input.pairId ?? null,
      external_id: input.externalId ?? null,
      notes: input.notes ?? null,
    });
    tradeId = Number(tradeResult.lastInsertRowid);

    // Update account balance
    const newBalance = acct.balance_cents + balanceChange;
    db.prepare("UPDATE accounts SET balance_cents = @balance, updated_at = datetime('now') WHERE id = @id").run({
      balance: newBalance,
      id: input.accountId,
    });

    // Record fee as separate transaction if applicable
    if (feeCents > 0) {
      db.prepare(`
        INSERT INTO transactions (account_id, type, amount_cents, balance_after_cents, reference)
        VALUES (@account_id, 'fee', @amount_cents, @balance_after_cents, @reference)
      `).run({
        account_id: input.accountId,
        amount_cents: feeCents,
        balance_after_cents: newBalance,
        reference: `trade:${tradeId}`,
      });
    }

    // Record realized P&L transaction if applicable
    if (realizedPnl !== null && realizedPnl !== 0) {
      db.prepare(`
        INSERT INTO transactions (account_id, type, amount_cents, balance_after_cents, reference)
        VALUES (@account_id, 'pnl_realized', @amount_cents, @balance_after_cents, @reference)
      `).run({
        account_id: input.accountId,
        amount_cents: Math.abs(realizedPnl),
        balance_after_cents: newBalance,
        reference: `trade:${tradeId}`,
      });
    }
  });

  doTrade();
  return getTradeById(db, tradeId)!;
}

function getTradeById(db: Database.Database, id: number): Trade | undefined {
  const row = db.prepare('SELECT * FROM trades WHERE id = @id').get({ id }) as TradeRow | undefined;
  return row ? toTrade(row) : undefined;
}

export function getTradesByPosition(db: Database.Database, positionId: number): Trade[] {
  const rows = db.prepare(
    'SELECT * FROM trades WHERE position_id = @position_id ORDER BY executed_at ASC',
  ).all({ position_id: positionId }) as TradeRow[];
  return rows.map(toTrade);
}

export function getRecentTrades(db: Database.Database, limit = 50): Trade[] {
  const rows = db.prepare(
    'SELECT * FROM trades ORDER BY executed_at DESC LIMIT @limit',
  ).all({ limit }) as TradeRow[];
  return rows.map(toTrade);
}

// ── Balance snapshots ──────────────────────────────────────────────

export function insertBalanceSnapshot(
  db: Database.Database,
  accountId: string,
  unrealizedPnlCents = 0,
): void {
  const acct = db.prepare('SELECT balance_cents FROM accounts WHERE id = @id').get({ id: accountId }) as { balance_cents: number } | undefined;
  if (!acct) return;

  db.prepare(`
    INSERT INTO balance_snapshots (account_id, balance_cents, unrealized_pnl_cents)
    VALUES (@account_id, @balance_cents, @unrealized_pnl_cents)
  `).run({
    account_id: accountId,
    balance_cents: acct.balance_cents,
    unrealized_pnl_cents: unrealizedPnlCents,
  });
}

export function snapshotAllAccounts(db: Database.Database): void {
  const accounts = db.prepare('SELECT id FROM accounts WHERE is_active = 1').all() as Array<{ id: string }>;
  if (accounts.length === 0) return;

  const doSnapshot = db.transaction(() => {
    for (const acct of accounts) {
      insertBalanceSnapshot(db, acct.id);
    }
  });
  doSnapshot();
}

export function getBalanceSnapshots(
  db: Database.Database,
  accountId: string,
  limit = 100,
): BalanceSnapshot[] {
  const rows = db.prepare(
    'SELECT * FROM balance_snapshots WHERE account_id = @account_id ORDER BY timestamp DESC LIMIT @limit',
  ).all({ account_id: accountId, limit }) as BalanceSnapshotRow[];
  return rows.map(toBalanceSnapshot);
}

// ── Summary / reporting ────────────────────────────────────────────

export function getBalanceSummary(db: Database.Database): BalanceSummary {
  const accounts = getAllAccounts(db);
  return {
    totalBalanceCents: accounts.reduce((sum, a) => sum + a.balanceCents, 0),
    byAccount: accounts.map((a) => ({
      accountId: a.id,
      platform: a.platform,
      label: a.label,
      balanceCents: a.balanceCents,
    })),
  };
}

export function getPnLSummary(db: Database.Database, startDate: string, endDate: string): PnLSummary {
  const rows = db.prepare(`
    SELECT platform, fee_cents, realized_pnl_cents
    FROM trades
    WHERE executed_at >= @start AND executed_at <= @end
  `).all({ start: startDate, end: endDate }) as Array<{
    platform: string;
    fee_cents: number;
    realized_pnl_cents: number | null;
  }>;

  let totalRealizedPnl = 0;
  let totalFees = 0;
  const byPlatform: PnLSummary['byPlatform'] = {};

  for (const row of rows) {
    const pnl = row.realized_pnl_cents ?? 0;
    const fee = row.fee_cents;
    totalRealizedPnl += pnl;
    totalFees += fee;

    if (!byPlatform[row.platform]) {
      byPlatform[row.platform] = { realizedPnlCents: 0, feesCents: 0, tradeCount: 0 };
    }
    byPlatform[row.platform].realizedPnlCents += pnl;
    byPlatform[row.platform].feesCents += fee;
    byPlatform[row.platform].tradeCount++;
  }

  return {
    periodStart: startDate,
    periodEnd: endDate,
    totalRealizedPnlCents: totalRealizedPnl,
    totalFeesCents: totalFees,
    netPnlCents: totalRealizedPnl - totalFees,
    tradeCount: rows.length,
    byPlatform,
  };
}

export function verifyAccountBalance(db: Database.Database, accountId: string): { ok: boolean; expected: number; actual: number } {
  const acct = db.prepare('SELECT balance_cents FROM accounts WHERE id = @id').get({ id: accountId }) as { balance_cents: number } | undefined;
  if (!acct) throw new Error(`Account not found: ${accountId}`);

  const lastTxn = db.prepare(
    'SELECT balance_after_cents FROM transactions WHERE account_id = @account_id ORDER BY id DESC LIMIT 1',
  ).get({ account_id: accountId }) as { balance_after_cents: number } | undefined;

  // If no transactions, the balance should be 0 (or whatever initial was set via direct insert)
  const expected = lastTxn?.balance_after_cents ?? 0;
  return {
    ok: expected === acct.balance_cents,
    expected,
    actual: acct.balance_cents,
  };
}

// ── Unrealized P&L (mark-to-market) ────────────────────────────────

export function getUnrealizedPnL(db: Database.Database): UnrealizedPnLReport {
  const positions = db.prepare(
    "SELECT * FROM positions WHERE status = 'open' ORDER BY opened_at DESC",
  ).all() as PositionRow[];

  let totalUnrealized = 0;
  let totalCostBasis = 0;
  let totalCurrentValue = 0;
  let withPrice = 0;
  let withoutPrice = 0;

  const mtmPositions: PositionMtm[] = positions.map((pos) => {
    const currentPrice = pos.pair_id
      ? getCurrentMarketPrice(pos.pair_id, pos.platform as 'kalshi' | 'polymarket', pos.side as 'yes' | 'no')
      : undefined;

    const currentValue = currentPrice != null ? currentPrice * pos.quantity : null;
    const unrealizedPnl = currentValue != null ? currentValue - pos.total_cost_cents : null;

    if (currentPrice != null) {
      withPrice++;
      totalUnrealized += unrealizedPnl!;
      totalCurrentValue += currentValue!;
    } else {
      withoutPrice++;
    }
    totalCostBasis += pos.total_cost_cents;

    return {
      positionId: pos.id,
      accountId: pos.account_id,
      platform: pos.platform,
      marketId: pos.market_id,
      side: pos.side,
      quantity: pos.quantity,
      avgEntryPriceCents: pos.avg_entry_price_cents,
      currentPriceCents: currentPrice ?? null,
      unrealizedPnlCents: unrealizedPnl,
      totalCostCents: pos.total_cost_cents,
      currentValueCents: currentValue,
      pairId: pos.pair_id ?? undefined,
    };
  });

  return {
    timestamp: new Date().toISOString(),
    positions: mtmPositions,
    totalUnrealizedPnlCents: totalUnrealized,
    totalCostBasisCents: totalCostBasis,
    totalCurrentValueCents: totalCurrentValue,
    positionsWithPriceData: withPrice,
    positionsWithoutPriceData: withoutPrice,
  };
}

// ── Enhanced reporting ──────────────────────────────────────────────

export function getDailySummary(db: Database.Database, date: string): DailySummary {
  const dayStart = `${date} 00:00:00`;
  const dayEnd = `${date} 23:59:59`;

  const tradeStats = db.prepare(`
    SELECT COUNT(*) as count,
           COALESCE(SUM(total_cents), 0) as volume,
           COALESCE(SUM(realized_pnl_cents), 0) as pnl,
           COALESCE(SUM(fee_cents), 0) as fees
    FROM trades WHERE executed_at >= @start AND executed_at <= @end
  `).get({ start: dayStart, end: dayEnd }) as {
    count: number; volume: number; pnl: number; fees: number;
  };

  const deposits = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total
    FROM transactions WHERE type = 'deposit' AND created_at >= @start AND created_at <= @end
  `).get({ start: dayStart, end: dayEnd }) as { count: number; total: number };

  const withdrawals = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total
    FROM transactions WHERE type = 'withdrawal' AND created_at >= @start AND created_at <= @end
  `).get({ start: dayStart, end: dayEnd }) as { count: number; total: number };

  const positionsOpened = db.prepare(
    "SELECT COUNT(*) as count FROM positions WHERE opened_at >= @start AND opened_at <= @end",
  ).get({ start: dayStart, end: dayEnd }) as { count: number };

  const positionsClosed = db.prepare(
    "SELECT COUNT(*) as count FROM positions WHERE closed_at >= @start AND closed_at <= @end AND status IN ('closed', 'settled')",
  ).get({ start: dayStart, end: dayEnd }) as { count: number };

  return {
    date,
    tradeCount: tradeStats.count,
    totalVolumeCents: tradeStats.volume,
    realizedPnlCents: tradeStats.pnl,
    feesCents: tradeStats.fees,
    netPnlCents: tradeStats.pnl - tradeStats.fees,
    depositsCountCents: { count: deposits.count, totalCents: deposits.total },
    withdrawalsCountCents: { count: withdrawals.count, totalCents: withdrawals.total },
    positionsOpened: positionsOpened.count,
    positionsClosed: positionsClosed.count,
  };
}

export function getWeeklySummary(db: Database.Database, startDate: string, endDate: string): DailySummary[] {
  const days: DailySummary[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    days.push(getDailySummary(db, dateStr));
    current.setDate(current.getDate() + 1);
  }

  return days;
}

export function getFeeBreakdown(db: Database.Database, startDate: string, endDate: string): FeeBreakdown {
  const rows = db.prepare(`
    SELECT platform, account_id, fee_cents, total_cents
    FROM trades
    WHERE executed_at >= @start AND executed_at <= @end AND fee_cents > 0
  `).all({ start: startDate, end: endDate }) as Array<{
    platform: string; account_id: string; fee_cents: number; total_cents: number;
  }>;

  const byPlatform: Record<string, number> = {};
  const byAccountMap: Record<string, { feesCents: number }> = {};
  let totalFees = 0;
  let totalVolume = 0;

  for (const row of rows) {
    totalFees += row.fee_cents;
    totalVolume += row.total_cents;
    byPlatform[row.platform] = (byPlatform[row.platform] ?? 0) + row.fee_cents;
    if (!byAccountMap[row.account_id]) byAccountMap[row.account_id] = { feesCents: 0 };
    byAccountMap[row.account_id].feesCents += row.fee_cents;
  }

  // Look up labels
  const byAccount = Object.entries(byAccountMap).map(([accountId, data]) => {
    const acct = db.prepare('SELECT label FROM accounts WHERE id = @id').get({ id: accountId }) as { label: string } | undefined;
    return { accountId, label: acct?.label ?? accountId, feesCents: data.feesCents };
  });

  return {
    periodStart: startDate,
    periodEnd: endDate,
    totalFeesCents: totalFees,
    byPlatform,
    byAccount,
    avgFeePerTradeCents: rows.length > 0 ? Math.round(totalFees / rows.length) : 0,
    feeAsPercentOfVolume: totalVolume > 0 ? Math.round((totalFees / totalVolume) * 10000) / 100 : 0,
  };
}

// ── CSV export helpers ──────────────────────────────────────────────

export function getTradesForExport(db: Database.Database, startDate?: string, endDate?: string): Trade[] {
  let sql = 'SELECT * FROM trades';
  const params: Record<string, string> = {};

  if (startDate && endDate) {
    sql += ' WHERE executed_at >= @start AND executed_at <= @end';
    params.start = startDate;
    params.end = endDate;
  }
  sql += ' ORDER BY executed_at ASC';

  const rows = db.prepare(sql).all(params) as TradeRow[];
  return rows.map(toTrade);
}

export function getTransactionsForExport(db: Database.Database, accountId?: string, startDate?: string, endDate?: string): Transaction[] {
  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params: Record<string, string> = {};

  if (accountId) {
    sql += ' AND account_id = @account_id';
    params.account_id = accountId;
  }
  if (startDate) {
    sql += ' AND created_at >= @start';
    params.start = startDate;
  }
  if (endDate) {
    sql += ' AND created_at <= @end';
    params.end = endDate;
  }
  sql += ' ORDER BY created_at ASC';

  const rows = db.prepare(sql).all(params) as TransactionRow[];
  return rows.map(toTransaction);
}

export function getAllPositionsForExport(db: Database.Database): Position[] {
  const rows = db.prepare('SELECT * FROM positions ORDER BY opened_at DESC').all() as PositionRow[];
  return rows.map(toPosition);
}
