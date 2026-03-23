/**
 * Quick test script for the Finance REST API.
 * Usage: npx tsx scripts/test-api.ts
 */

import fs from 'fs';
import { initDatabase } from '../src/store/db.js';
import { startApiServer } from '../src/api/server.js';
import { createLogger } from '../src/logger.js';

const logger = createLogger('test-api');
const TEST_DB = 'data/test-api.db';
const PORT = 3099;
const BASE = `http://localhost:${PORT}`;

if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const db = initDatabase(TEST_DB);
const server = startApiServer(db, PORT);

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    logger.info(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    logger.error(`[FAIL] ${name}: ${(err as Error).message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function req(method: string, path: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : null;
  return { status: res.status, data };
}

async function run() {
  // Wait for server
  await new Promise((r) => setTimeout(r, 500));

  await check('GET /health', async () => {
    const { status, data } = await req('GET', '/health');
    assert(status === 200, `status=${status}`);
    assert(data.status === 'ok', `data=${JSON.stringify(data)}`);
  });

  await check('POST /api/accounts', async () => {
    const { status, data } = await req('POST', '/api/accounts', {
      id: 'acct1', platform: 'external', label: 'Test Account', initialBalanceCents: 50000,
    });
    assert(status === 201, `status=${status}`);
    assert(data.balanceCents === 50000, `balance=${data.balanceCents}`);
  });

  await check('GET /api/accounts', async () => {
    const { data } = await req('GET', '/api/accounts');
    assert(Array.isArray(data) && data.length === 1, `length=${data?.length}`);
  });

  await check('GET /api/accounts/:id', async () => {
    const { status, data } = await req('GET', '/api/accounts/acct1');
    assert(status === 200, `status=${status}`);
    assert(data.id === 'acct1', `id=${data.id}`);
  });

  await check('GET /api/accounts/:id 404', async () => {
    const { status } = await req('GET', '/api/accounts/nope');
    assert(status === 404, `status=${status}`);
  });

  await check('POST /api/accounts/:id/deposits', async () => {
    const { status, data } = await req('POST', '/api/accounts/acct1/deposits', { amountCents: 10000 });
    assert(status === 201, `status=${status}`);
    assert(data.balanceAfterCents === 60000, `balance=${data.balanceAfterCents}`);
  });

  await check('POST /api/accounts/:id/withdrawals', async () => {
    const { status, data } = await req('POST', '/api/accounts/acct1/withdrawals', { amountCents: 5000 });
    assert(status === 201, `status=${status}`);
    assert(data.balanceAfterCents === 55000, `balance=${data.balanceAfterCents}`);
  });

  await check('POST withdrawal overdraft returns 400', async () => {
    const { status, data } = await req('POST', '/api/accounts/acct1/withdrawals', { amountCents: 999999 });
    assert(status === 400, `status=${status}`);
    assert(data.error.includes('Insufficient'), `error=${data.error}`);
  });

  // Create second account for transfers
  await req('POST', '/api/accounts', { id: 'acct2', platform: 'external', label: 'Account 2' });

  await check('POST /api/transfers', async () => {
    const { status, data } = await req('POST', '/api/transfers', {
      fromAccountId: 'acct1', toAccountId: 'acct2', amountCents: 5000,
    });
    assert(status === 201, `status=${status}`);
    assert(data.outTxn.type === 'transfer_out', `type=${data.outTxn.type}`);
    assert(data.inTxn.type === 'transfer_in', `type=${data.inTxn.type}`);
  });

  await check('GET /api/accounts/:id/transactions', async () => {
    const { data } = await req('GET', '/api/accounts/acct1/transactions');
    assert(Array.isArray(data) && data.length >= 3, `length=${data?.length}`);
  });

  await check('POST /api/trades (buy)', async () => {
    const { status, data } = await req('POST', '/api/trades', {
      accountId: 'acct1', platform: 'kalshi', marketId: 'MKT-1',
      side: 'yes', direction: 'buy', quantity: 10, priceCents: 60,
    });
    assert(status === 201, `status=${status}`);
    assert(data.totalCents === 600, `total=${data.totalCents}`);
  });

  await check('GET /api/positions', async () => {
    const { data } = await req('GET', '/api/positions?accountId=acct1');
    assert(data.length === 1, `length=${data.length}`);
    assert(data[0].quantity === 10, `qty=${data[0].quantity}`);
  });

  await check('POST /api/trades (sell with P&L)', async () => {
    const { status, data } = await req('POST', '/api/trades', {
      accountId: 'acct1', platform: 'kalshi', marketId: 'MKT-1',
      side: 'yes', direction: 'sell', quantity: 10, priceCents: 75,
    });
    assert(status === 201, `status=${status}`);
    assert(data.realizedPnlCents === 150, `pnl=${data.realizedPnlCents}`);
  });

  await check('GET /api/trades/recent', async () => {
    const { data } = await req('GET', '/api/trades/recent?limit=10');
    assert(data.length === 2, `length=${data.length}`);
  });

  await check('POST /api/snapshots', async () => {
    const { status } = await req('POST', '/api/snapshots');
    assert(status === 201, `status=${status}`);
  });

  await check('GET /api/accounts/:id/snapshots', async () => {
    const { data } = await req('GET', '/api/accounts/acct1/snapshots');
    assert(data.length >= 1, `length=${data.length}`);
  });

  await check('GET /api/reports/balance-summary', async () => {
    const { data } = await req('GET', '/api/reports/balance-summary');
    assert(data.byAccount.length === 2, `accounts=${data.byAccount.length}`);
    assert(typeof data.totalBalanceCents === 'number', `total=${data.totalBalanceCents}`);
  });

  await check('GET /api/reports/pnl', async () => {
    const { data } = await req('GET', '/api/reports/pnl');
    assert(data.tradeCount === 2, `trades=${data.tradeCount}`);
    assert(data.totalRealizedPnlCents === 150, `pnl=${data.totalRealizedPnlCents}`);
  });

  await check('GET /api/accounts/:id/verify', async () => {
    const { data } = await req('GET', '/api/accounts/acct1/verify');
    assert(data.ok === true, `ok=${data.ok}`);
  });

  await check('DELETE /api/accounts/:id', async () => {
    const { status } = await req('DELETE', '/api/accounts/acct2');
    assert(status === 204, `status=${status}`);
    // Should no longer appear in list
    const { data } = await req('GET', '/api/accounts');
    assert(data.length === 1, `remaining=${data.length}`);
  });

  // Summary
  const total = passed + failed;
  logger.info(`\n=== API Test Results: ${passed}/${total} passed ===`);
  if (failed > 0) logger.error(`${failed} test(s) FAILED`);

  server.close();
  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  for (const s of ['-wal', '-shm']) {
    if (fs.existsSync(TEST_DB + s)) fs.unlinkSync(TEST_DB + s);
  }
  process.exit(failed > 0 ? 1 : 0);
}

run();
