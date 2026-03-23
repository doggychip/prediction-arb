/**
 * End-to-end test script for the financial system (Phase 1 + Phase 2).
 * Usage: npm run test-finance
 */

import fs from 'fs';
import { initDatabase } from '../src/store/db.js';
import {
  createAccount,
  getAccount,
  getAllAccounts,
  recordDeposit,
  recordWithdrawal,
  recordTransfer,
  recordTrade,
  getOpenPositions,
  getTradesByPosition,
  snapshotAllAccounts,
  getBalanceSnapshots,
  getBalanceSummary,
  getPnLSummary,
  verifyAccountBalance,
  getTransactions,
} from '../src/finance/index.js';
import { createLogger } from '../src/logger.js';

const logger = createLogger('test-finance');
const TEST_DB_PATH = 'data/test-finance.db';

let passed = 0;
let failed = 0;

function assert(condition: boolean, description: string, detail?: string): void {
  if (condition) {
    passed++;
    logger.info(`[PASS] ${description}`);
  } else {
    failed++;
    logger.error(`[FAIL] ${description}${detail ? ': ' + detail : ''}`);
  }
}

function assertThrows(fn: () => void, description: string, expectedMsg?: string): void {
  try {
    fn();
    failed++;
    logger.error(`[FAIL] ${description}: expected error but none was thrown`);
  } catch (err) {
    const msg = (err as Error).message;
    if (expectedMsg && !msg.includes(expectedMsg)) {
      failed++;
      logger.error(`[FAIL] ${description}: expected "${expectedMsg}" but got "${msg}"`);
    } else {
      passed++;
      logger.info(`[PASS] ${description}`);
    }
  }
}

function main() {
  // Clean up any previous test DB
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  logger.info('=== Financial System Tests ===');

  // 1. Schema creation
  const db = initDatabase(TEST_DB_PATH);

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all() as Array<{ name: string }>;
  const tableNames = tables.map((t) => t.name);

  for (const expected of ['accounts', 'transactions', 'positions', 'trades', 'balance_snapshots']) {
    assert(tableNames.includes(expected), `Table "${expected}" exists`);
  }

  // 2. Account creation
  const kalshi = createAccount(db, {
    id: 'kalshi_prod',
    platform: 'kalshi',
    label: 'Kalshi Production',
    initialBalanceCents: 50_000,
  });
  assert(kalshi.balanceCents === 50_000, 'Kalshi account created with $500', `balance=${kalshi.balanceCents}`);

  const poly = createAccount(db, {
    id: 'poly_main',
    platform: 'polymarket',
    label: 'Polymarket Main',
    initialBalanceCents: 30_000,
  });
  assert(poly.balanceCents === 30_000, 'Polymarket account created with $300', `balance=${poly.balanceCents}`);

  createAccount(db, {
    id: 'bank',
    platform: 'external',
    label: 'Bank Account',
  });

  const allAccounts = getAllAccounts(db);
  assert(allAccounts.length === 3, 'getAllAccounts returns 3 accounts', `got ${allAccounts.length}`);

  // 3. Deposits
  const depositTxn = recordDeposit(db, { accountId: 'bank', amountCents: 20_000 });
  assert(depositTxn.amountCents === 20_000, 'Deposit $200 to bank');
  assert(depositTxn.balanceAfterCents === 20_000, 'Bank balance after deposit = $200', `got ${depositTxn.balanceAfterCents}`);

  const bankAcct = getAccount(db, 'bank')!;
  assert(bankAcct.balanceCents === 20_000, 'Bank account balance updated', `got ${bankAcct.balanceCents}`);

  const bankTxns = getTransactions(db, 'bank');
  assert(bankTxns.length === 1, 'Bank has 1 transaction', `got ${bankTxns.length}`);
  assert(bankTxns[0].type === 'deposit', 'Transaction type is deposit', `got ${bankTxns[0].type}`);

  const bankVerify = verifyAccountBalance(db, 'bank');
  assert(bankVerify.ok, 'Bank balance verification passes');

  // 4. Withdrawals
  recordWithdrawal(db, { accountId: 'kalshi_prod', amountCents: 10_000 });
  const kalshiAfterW = getAccount(db, 'kalshi_prod')!;
  assert(kalshiAfterW.balanceCents === 40_000, 'Kalshi balance after $100 withdrawal', `got ${kalshiAfterW.balanceCents}`);

  assertThrows(
    () => recordWithdrawal(db, { accountId: 'kalshi_prod', amountCents: 999_900 }),
    'Withdrawal exceeding balance throws error',
    'Insufficient balance',
  );

  // 5. Transfers
  const { outTxn, inTxn } = recordTransfer(db, {
    fromAccountId: 'bank',
    toAccountId: 'poly_main',
    amountCents: 5_000,
  });

  const bankAfterT = getAccount(db, 'bank')!;
  const polyAfterT = getAccount(db, 'poly_main')!;
  assert(bankAfterT.balanceCents === 15_000, 'Bank after $50 transfer out', `got ${bankAfterT.balanceCents}`);
  assert(polyAfterT.balanceCents === 35_000, 'Poly after $50 transfer in', `got ${polyAfterT.balanceCents}`);
  assert(outTxn.relatedTransactionId === inTxn.id, 'Transfer out links to transfer in');
  assert(inTxn.relatedTransactionId === outTxn.id, 'Transfer in links to transfer out');

  assertThrows(
    () => recordTransfer(db, { fromAccountId: 'bank', toAccountId: 'bank', amountCents: 100 }),
    'Self-transfer throws error',
    'same account',
  );

  // 6. Trade recording (buy)
  const buyTrade1 = recordTrade(db, {
    accountId: 'kalshi_prod',
    platform: 'kalshi',
    marketId: 'TICKER-A',
    side: 'yes',
    direction: 'buy',
    quantity: 10,
    priceCents: 60,
  });
  assert(buyTrade1.totalCents === 600, 'Buy trade 1: 10 x 60¢ = 600¢', `got ${buyTrade1.totalCents}`);

  let positions = getOpenPositions(db, 'kalshi_prod');
  assert(positions.length === 1, 'One open position after first buy', `got ${positions.length}`);
  assert(positions[0].quantity === 10, 'Position qty = 10', `got ${positions[0].quantity}`);
  assert(positions[0].avgEntryPriceCents === 60, 'Position avg entry = 60¢', `got ${positions[0].avgEntryPriceCents}`);

  const kalshiAfterBuy1 = getAccount(db, 'kalshi_prod')!;
  assert(kalshiAfterBuy1.balanceCents === 40_000 - 600, 'Kalshi balance reduced by 600¢', `got ${kalshiAfterBuy1.balanceCents}`);

  // Second buy at different price
  recordTrade(db, {
    accountId: 'kalshi_prod',
    platform: 'kalshi',
    marketId: 'TICKER-A',
    side: 'yes',
    direction: 'buy',
    quantity: 5,
    priceCents: 50,
  });

  positions = getOpenPositions(db, 'kalshi_prod');
  const pos = positions[0];
  assert(pos.quantity === 15, 'Position qty = 15 after second buy', `got ${pos.quantity}`);
  // weighted avg = round((600 + 250) / 15) = round(56.67) = 57
  assert(pos.avgEntryPriceCents === 57, 'Weighted avg entry = 57¢', `got ${pos.avgEntryPriceCents}`);

  const kalshiAfterBuy2 = getAccount(db, 'kalshi_prod')!;
  assert(
    kalshiAfterBuy2.balanceCents === 40_000 - 600 - 250,
    'Kalshi balance reduced by another 250¢',
    `got ${kalshiAfterBuy2.balanceCents}`,
  );

  // 7. Trade recording (sell with P&L)
  const sellTrade1 = recordTrade(db, {
    accountId: 'kalshi_prod',
    platform: 'kalshi',
    marketId: 'TICKER-A',
    side: 'yes',
    direction: 'sell',
    quantity: 10,
    priceCents: 70,
  });
  // realized_pnl = (70 - 57) * 10 = 130
  assert(sellTrade1.realizedPnlCents === 130, 'Sell 10 at 70¢: realized P&L = 130¢', `got ${sellTrade1.realizedPnlCents}`);

  positions = getOpenPositions(db, 'kalshi_prod');
  assert(positions[0].quantity === 5, 'Position reduced to qty=5', `got ${positions[0].quantity}`);

  const kalshiAfterSell1 = getAccount(db, 'kalshi_prod')!;
  // previous balance was 39150, sell proceeds = 700, new = 39850
  assert(
    kalshiAfterSell1.balanceCents === 40_000 - 600 - 250 + 700,
    'Kalshi balance credited 700¢ sell proceeds',
    `got ${kalshiAfterSell1.balanceCents}`,
  );

  // 8. Full position close
  const sellTrade2 = recordTrade(db, {
    accountId: 'kalshi_prod',
    platform: 'kalshi',
    marketId: 'TICKER-A',
    side: 'yes',
    direction: 'sell',
    quantity: 5,
    priceCents: 40,
  });
  // realized_pnl = (40 - 57) * 5 = -85
  assert(sellTrade2.realizedPnlCents === -85, 'Sell 5 at 40¢: realized P&L = -85¢ (loss)', `got ${sellTrade2.realizedPnlCents}`);

  positions = getOpenPositions(db, 'kalshi_prod');
  assert(positions.length === 0, 'No open positions after full close', `got ${positions.length}`);

  // Check trade history for the position
  const posTrades = getTradesByPosition(db, sellTrade1.positionId!);
  assert(posTrades.length === 4, 'Position has 4 trades total (2 buys + 2 sells)', `got ${posTrades.length}`);

  // 9. Balance snapshots
  snapshotAllAccounts(db);
  const kalshiSnaps = getBalanceSnapshots(db, 'kalshi_prod');
  assert(kalshiSnaps.length >= 1, 'Kalshi has balance snapshots', `got ${kalshiSnaps.length}`);

  const polySnaps = getBalanceSnapshots(db, 'poly_main');
  assert(polySnaps.length >= 1, 'Polymarket has balance snapshots', `got ${polySnaps.length}`);

  const bankSnaps = getBalanceSnapshots(db, 'bank');
  assert(bankSnaps.length >= 1, 'Bank has balance snapshots', `got ${bankSnaps.length}`);

  // 10. Summary queries
  const balSummary = getBalanceSummary(db);
  assert(balSummary.byAccount.length === 3, 'Balance summary has 3 accounts', `got ${balSummary.byAccount.length}`);
  const expectedTotal = 15_000 + 35_000 + (40_000 - 600 - 250 + 700 + 200);
  assert(
    balSummary.totalBalanceCents === expectedTotal,
    `Total balance = ${expectedTotal}¢`,
    `got ${balSummary.totalBalanceCents}`,
  );

  const pnl = getPnLSummary(db, '2000-01-01', '2099-12-31');
  assert(pnl.tradeCount === 4, 'P&L summary: 4 trades', `got ${pnl.tradeCount}`);
  // total realized = 130 + (-85) = 45
  assert(pnl.totalRealizedPnlCents === 45, 'Total realized P&L = 45¢', `got ${pnl.totalRealizedPnlCents}`);

  // Verify all account balances
  for (const acctId of ['kalshi_prod', 'poly_main', 'bank']) {
    const v = verifyAccountBalance(db, acctId);
    assert(v.ok, `Account ${acctId} balance verification passes`, `expected=${v.expected} actual=${v.actual}`);
  }

  // 11. Cleanup
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  // Also clean up WAL/SHM files
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(TEST_DB_PATH + suffix)) {
      fs.unlinkSync(TEST_DB_PATH + suffix);
    }
  }

  // Summary
  const total = passed + failed;
  logger.info(`\n=== Results: ${passed}/${total} tests passed ===`);
  if (failed > 0) {
    logger.error(`${failed} test(s) FAILED`);
    process.exit(1);
  }
  logger.info('All tests passed!');
}

main();
