import type { ArbOpportunity, ArbStrategy } from '../arb/types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('executor');

export type ExecutionMode = 'disabled' | 'paper' | 'live';

export interface ExecutionConfig {
  mode: ExecutionMode;
  maxPositionDollars: number;
  maxDailyTrades: number;
  minNetSpreadCents: number;
  minDepthDollars: number;
  killSwitchEnabled: boolean;
}

export interface TradeOrder {
  id: string;
  pairId: string;
  strategy: ArbStrategy;
  kalshiTicker: string;
  polymarketId: string;
  kalshiSide: 'yes' | 'no';
  polySide: 'yes' | 'no';
  quantityDollars: number;
  expectedNetSpreadCents: number;
  mode: ExecutionMode;
  status: 'pending' | 'filled' | 'partial' | 'rejected' | 'error';
  createdAt: string;
  filledAt?: string;
  error?: string;
}

export interface ExecutionStats {
  mode: ExecutionMode;
  tradesPlaced: number;
  tradesToday: number;
  totalPnlCents: number;
  openPositionDollars: number;
  killSwitchTripped: boolean;
  lastTradeAt?: string;
}

/**
 * Trade execution engine with paper trading mode, position limits, and kill switch.
 *
 * Modes:
 * - disabled: No trades executed (detection only)
 * - paper: Simulated trades logged but not sent to exchanges
 * - live: Real trades placed via Kalshi/Polymarket APIs
 */
export class TradeExecutor {
  private config: ExecutionConfig;
  private trades: TradeOrder[] = [];
  private tradesToday = 0;
  private dailyResetDate = '';
  private openPositionDollars = 0;
  private totalPnlCents = 0;
  private killSwitchTripped = false;

  constructor(config: ExecutionConfig) {
    this.config = config;
    logger.info(
      `Trade executor initialized: mode=${config.mode}, maxPosition=$${config.maxPositionDollars}, maxDaily=${config.maxDailyTrades}`,
    );
  }

  /** Check if the kill switch has been tripped. */
  isKillSwitched(): boolean {
    return this.killSwitchTripped;
  }

  /** Manually trip the kill switch. */
  tripKillSwitch(reason: string): void {
    this.killSwitchTripped = true;
    logger.error(`KILL SWITCH TRIPPED: ${reason}`);
  }

  /** Reset the kill switch (manual recovery). */
  resetKillSwitch(): void {
    this.killSwitchTripped = false;
    logger.info('Kill switch reset');
  }

  /** Get execution stats. */
  getStats(): ExecutionStats {
    return {
      mode: this.config.mode,
      tradesPlaced: this.trades.length,
      tradesToday: this.tradesToday,
      totalPnlCents: this.totalPnlCents,
      openPositionDollars: this.openPositionDollars,
      killSwitchTripped: this.killSwitchTripped,
      lastTradeAt:
        this.trades.length > 0 ? this.trades[this.trades.length - 1].createdAt : undefined,
    };
  }

  /** Get recent trade history. */
  getTradeHistory(limit = 50): TradeOrder[] {
    return this.trades.slice(-limit);
  }

  /**
   * Attempt to execute an arb opportunity.
   * Returns the trade order (paper or live) or null if rejected.
   */
  async execute(opp: ArbOpportunity): Promise<TradeOrder | null> {
    // Pre-flight checks
    const rejection = this.checkPreFlight(opp);
    if (rejection) {
      logger.info(`Trade rejected: ${rejection} | ${opp.kalshiTicker} ↔ ${opp.polymarketId}`);
      return null;
    }

    // Reset daily counter if new day
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyResetDate) {
      this.tradesToday = 0;
      this.dailyResetDate = today;
    }

    // Determine position size (min of: available depth, max position - open, $100 default)
    const maxAllowable = this.config.maxPositionDollars - this.openPositionDollars;
    const depthLimit = opp.availableDepthDollars > 0 ? opp.availableDepthDollars : 100;
    const quantityDollars = Math.min(maxAllowable, depthLimit, 100);

    if (quantityDollars <= 0) {
      logger.info('Trade rejected: no available position capacity');
      return null;
    }

    const kalshiSide: 'yes' | 'no' = opp.strategy === 'kalshi_yes_poly_no' ? 'yes' : 'no';
    const polySide: 'yes' | 'no' = opp.strategy === 'kalshi_yes_poly_no' ? 'no' : 'yes';

    const order: TradeOrder = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pairId: opp.pairId,
      strategy: opp.strategy,
      kalshiTicker: opp.kalshiTicker,
      polymarketId: opp.polymarketId,
      kalshiSide,
      polySide,
      quantityDollars,
      expectedNetSpreadCents: opp.netSpreadCents,
      mode: this.config.mode,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    if (this.config.mode === 'paper') {
      return this.executePaper(order);
    } else if (this.config.mode === 'live') {
      return this.executeLive(order);
    }

    return null;
  }

  private checkPreFlight(opp: ArbOpportunity): string | null {
    if (this.config.mode === 'disabled') return 'execution disabled';
    if (this.killSwitchTripped) return 'kill switch tripped';
    if (this.config.killSwitchEnabled && this.killSwitchTripped) return 'kill switch active';

    if (opp.netSpreadCents < this.config.minNetSpreadCents) {
      return `net spread ${opp.netSpreadCents}¢ < min ${this.config.minNetSpreadCents}¢`;
    }
    if (
      this.config.minDepthDollars > 0 &&
      opp.availableDepthDollars < this.config.minDepthDollars
    ) {
      return `depth $${opp.availableDepthDollars} < min $${this.config.minDepthDollars}`;
    }

    const today = new Date().toISOString().slice(0, 10);
    const effectiveTodayCount = today === this.dailyResetDate ? this.tradesToday : 0;
    if (effectiveTodayCount >= this.config.maxDailyTrades) {
      return `daily limit reached (${this.config.maxDailyTrades})`;
    }

    if (this.openPositionDollars >= this.config.maxPositionDollars) {
      return `max position $${this.config.maxPositionDollars} reached`;
    }

    return null;
  }

  private executePaper(order: TradeOrder): TradeOrder {
    order.status = 'filled';
    order.filledAt = new Date().toISOString();

    this.trades.push(order);
    this.tradesToday++;
    this.openPositionDollars += order.quantityDollars;
    this.totalPnlCents += order.expectedNetSpreadCents;

    logger.info(
      `[PAPER] Trade executed: ${order.strategy} $${order.quantityDollars} | ` +
        `expected net=${order.expectedNetSpreadCents}¢ | ${order.kalshiTicker}`,
    );

    return order;
  }

  private async executeLive(order: TradeOrder): Promise<TradeOrder> {
    // Live execution would call Kalshi + Polymarket APIs here.
    // For safety, this is a placeholder that logs the intent and
    // requires explicit API integration before real trades are placed.
    logger.warn(
      `[LIVE] Trade execution not yet wired to exchange APIs. ` +
        `Would execute: ${order.strategy} $${order.quantityDollars} | ${order.kalshiTicker}`,
    );

    order.status = 'rejected';
    order.error = 'Live execution requires API integration (not yet implemented)';
    this.trades.push(order);

    return order;
  }
}
