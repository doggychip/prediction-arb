import type { Platform } from '../types.js';

export type AccountPlatform = Platform | 'external';

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer_in'
  | 'transfer_out'
  | 'fee'
  | 'pnl_realized';

export type PositionSide = 'yes' | 'no';
export type PositionStatus = 'open' | 'closed' | 'settled';
export type TradeDirection = 'buy' | 'sell';

export interface Account {
  id: string;
  platform: AccountPlatform;
  label: string;
  balanceCents: number;
  currency: string;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: number;
  accountId: string;
  type: TransactionType;
  amountCents: number;
  balanceAfterCents: number;
  relatedTransactionId?: number;
  reference?: string;
  notes?: string;
  createdAt: string;
}

export interface Position {
  id: number;
  accountId: string;
  platform: Platform;
  marketId: string;
  side: PositionSide;
  quantity: number;
  avgEntryPriceCents: number;
  totalCostCents: number;
  status: PositionStatus;
  pairId?: string;
  openedAt: string;
  closedAt?: string;
  updatedAt: string;
}

export interface Trade {
  id: number;
  positionId?: number;
  accountId: string;
  platform: Platform;
  marketId: string;
  side: PositionSide;
  direction: TradeDirection;
  quantity: number;
  priceCents: number;
  totalCents: number;
  feeCents: number;
  realizedPnlCents?: number;
  pairId?: string;
  externalId?: string;
  notes?: string;
  executedAt: string;
}

export interface BalanceSnapshot {
  id: number;
  accountId: string;
  balanceCents: number;
  unrealizedPnlCents: number;
  timestamp: string;
}

// --- Input types ---

export interface CreateAccountInput {
  id: string;
  platform: AccountPlatform;
  label: string;
  initialBalanceCents?: number;
  currency?: string;
  notes?: string;
}

export interface RecordDepositInput {
  accountId: string;
  amountCents: number;
  reference?: string;
  notes?: string;
}

export interface RecordWithdrawalInput {
  accountId: string;
  amountCents: number;
  reference?: string;
  notes?: string;
}

export interface RecordTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  reference?: string;
  notes?: string;
}

export interface RecordTradeInput {
  accountId: string;
  platform: Platform;
  marketId: string;
  side: PositionSide;
  direction: TradeDirection;
  quantity: number;
  priceCents: number;
  feeCents?: number;
  pairId?: string;
  externalId?: string;
  notes?: string;
}

// --- Summary types ---

export interface BalanceSummary {
  totalBalanceCents: number;
  byAccount: Array<{
    accountId: string;
    platform: AccountPlatform;
    label: string;
    balanceCents: number;
  }>;
}

export interface PnLSummary {
  periodStart: string;
  periodEnd: string;
  totalRealizedPnlCents: number;
  totalFeesCents: number;
  netPnlCents: number;
  tradeCount: number;
  byPlatform: Record<string, {
    realizedPnlCents: number;
    feesCents: number;
    tradeCount: number;
  }>;
}

// --- Unrealized P&L ---

export interface PositionMtm {
  positionId: number;
  accountId: string;
  platform: string;
  marketId: string;
  side: string;
  quantity: number;
  avgEntryPriceCents: number;
  currentPriceCents: number | null;
  unrealizedPnlCents: number | null;
  totalCostCents: number;
  currentValueCents: number | null;
  pairId?: string;
}

export interface UnrealizedPnLReport {
  timestamp: string;
  positions: PositionMtm[];
  totalUnrealizedPnlCents: number;
  totalCostBasisCents: number;
  totalCurrentValueCents: number;
  positionsWithPriceData: number;
  positionsWithoutPriceData: number;
}

// --- Enhanced reporting ---

export interface DailySummary {
  date: string;
  tradeCount: number;
  totalVolumeCents: number;
  realizedPnlCents: number;
  feesCents: number;
  netPnlCents: number;
  depositsCountCents: { count: number; totalCents: number };
  withdrawalsCountCents: { count: number; totalCents: number };
  positionsOpened: number;
  positionsClosed: number;
}

export interface FeeBreakdown {
  periodStart: string;
  periodEnd: string;
  totalFeesCents: number;
  byPlatform: Record<string, number>;
  byAccount: Array<{ accountId: string; label: string; feesCents: number }>;
  avgFeePerTradeCents: number;
  feeAsPercentOfVolume: number;
}
