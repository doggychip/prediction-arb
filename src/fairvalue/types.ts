import type { BinanceSymbol } from '../binance/types.js';

export type FvSide = 'yes' | 'no';

/** Mirrors the fv_opportunities DB row. */
export interface FvOpportunity {
  polymarketId: string;
  tokenId: string;
  side: FvSide;
  question: string;

  marketPriceCents: number;
  fairValueCents: number;
  binanceSpotCents: number;
  binanceSymbol: BinanceSymbol;
  strikeCents: number | null;

  timeToExpirySec: number;
  annualizedVol: number;

  /** fairValue − marketPrice (yes leg), or analogous for no leg, after taker fee. */
  edgeCents: number;

  detectedAt: string;
}

export interface FvAnalysisInput {
  polymarketId: string;
  tokenId: string;
  side: FvSide;
  question: string;
  marketAskCents: number;
  binanceSpotCents: number;
  binanceSymbol: BinanceSymbol;
  strikeCents: number;
  timeToExpirySec: number;
  /** NaN when volReady is false. */
  annualizedVol: number;
  volReady: boolean;
  edgeThresholdCents: number;
  takerFeeCents: number;
  /** Hard reject if abs(edge) exceeds this — model-error guard. */
  suspectEdgeAbsCents: number;
}

/**
 * Discriminated union so the orchestrator can count skips by reason.
 * Filter-stage skips happen earlier; see src/fairvalue/market-filter.ts.
 */
export type DetectorResult =
  | { kind: 'opportunity'; opportunity: FvOpportunity }
  | { kind: 'skip'; reason: 'vol_not_ready' | 'edge_below_threshold' | 'suspect_edge' };
