#!/usr/bin/env tsx
/**
 * Backtest CLI — replay historical price snapshots through the arb detector.
 *
 * Usage:
 *   npm run backtest
 *   npm run backtest -- --start 2025-01-01 --end 2025-01-31
 *   npm run backtest -- --pair-id abc123 --fee-rate 0.05
 */

import { loadConfig } from '../src/config.js';
import { initDatabase } from '../src/store/db.js';
import { runBacktest, type BacktestConfig } from '../src/backtest/engine.js';

function parseArgs(): {
  startDate?: string;
  endDate?: string;
  pairIds?: string[];
  kalshiFeeRate?: number;
  polyFeeRate?: number;
} {
  const args = process.argv.slice(2);
  const result: ReturnType<typeof parseArgs> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--start':
        result.startDate = args[++i];
        break;
      case '--end':
        result.endDate = args[++i];
        break;
      case '--pair-id':
        result.pairIds = result.pairIds || [];
        result.pairIds.push(args[++i]);
        break;
      case '--kalshi-fee':
        result.kalshiFeeRate = parseFloat(args[++i]);
        break;
      case '--poly-fee':
        result.polyFeeRate = parseFloat(args[++i]);
        break;
    }
  }

  return result;
}

function main() {
  const config = loadConfig();
  const args = parseArgs();

  const db = initDatabase(config.dbPath);

  const backtestConfig: BacktestConfig = {
    thresholds: {
      kalshiFeeRate: args.kalshiFeeRate ?? config.kalshiFeeRate,
      polymarketFeeRate: args.polyFeeRate ?? config.polymarketFeeRate,
      minSpreadCents: config.minSpreadCents,
      suspectSpreadCents: config.suspectSpreadCents,
    },
    pairIds: args.pairIds,
    startDate: args.startDate,
    endDate: args.endDate,
  };

  console.log('\n=== prediction-arb backtest ===\n');
  console.log('Config:', JSON.stringify(backtestConfig, null, 2));

  const result = runBacktest(db, backtestConfig);

  console.log('\n--- Results ---');
  console.log(`Pairs analyzed:      ${result.pairsAnalyzed}`);
  console.log(`Snapshots processed: ${result.snapshotsProcessed}`);
  console.log(`Total trades:        ${result.summary.totalTrades}`);
  console.log(`Win rate:            ${(result.summary.winRate * 100).toFixed(1)}%`);
  console.log(`Gross P&L:           ${result.summary.totalGrossPnlCents}¢`);
  console.log(`Total fees:          ${result.summary.totalFeesCents}¢`);
  console.log(`Net P&L:             ${result.summary.totalNetPnlCents}¢`);
  console.log(`Avg net spread:      ${result.summary.avgNetSpreadCents}¢`);
  console.log(`Max net spread:      ${result.summary.maxNetSpreadCents}¢`);

  if (Object.keys(result.summary.tradesByStrategy).length > 0) {
    console.log('\nBy strategy:');
    for (const [strategy, count] of Object.entries(result.summary.tradesByStrategy)) {
      console.log(`  ${strategy}: ${count} trades`);
    }
  }

  if (result.trades.length > 0) {
    console.log('\nTop 10 trades by net spread:');
    const top = [...result.trades].sort((a, b) => b.netSpreadCents - a.netSpreadCents).slice(0, 10);
    for (const t of top) {
      console.log(
        `  ${t.entryTime} | ${t.strategy} | net=${t.netSpreadCents}¢ gross=${t.grossSpreadCents}¢ | ${t.kalshiTicker}`,
      );
    }
  }

  db.close();
  console.log('\nDone.');
}

main();
