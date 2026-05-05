import crypto from 'crypto';
import type { KalshiMarket } from '../kalshi/types.js';
import type { PolymarketMarket } from '../polymarket/types.js';
import type { MarketPair } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('matcher');

/**
 * Normalize a string for comparison:
 * lowercase, strip punctuation, collapse whitespace
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract meaningful tokens from text, filtering out common stop words.
 */
const STOP_WORDS = new Set([
  'will', 'the', 'be', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of',
  'by', 'is', 'it', 'or', 'and', 'with', 'this', 'that', 'what', 'how',
  'does', 'do', 'than', 'more', 'less', 'above', 'below', 'over', 'under',
  'before', 'after', 'yes', 'no', 'between',
]);

function extractTokens(text: string): Set<string> {
  const normalized = normalize(text);
  const tokens = normalized.split(' ').filter(t => t.length > 1 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

/**
 * Token-based Jaccard similarity: ratio of shared words.
 */
function tokenSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  // Iterate over the smaller set for performance
  const [smaller, larger] = tokensA.size <= tokensB.size
    ? [tokensA, tokensB]
    : [tokensB, tokensA];

  for (const t of smaller) {
    if (larger.has(t)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Build an inverted index: token -> list of market indices.
 * This allows O(1) lookup of which Polymarket markets share tokens with a Kalshi market.
 */
interface IndexedMarket {
  index: number;
  tokens: Set<string>;
  text: string;
}

function buildInvertedIndex(markets: IndexedMarket[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const m of markets) {
    for (const token of m.tokens) {
      if (!index.has(token)) {
        index.set(token, []);
      }
      index.get(token)!.push(m.index);
    }
  }
  return index;
}

export interface MatchCandidate {
  kalshiMarket: KalshiMarket;
  polymarketMarket: PolymarketMarket;
  confidence: number;
}

export interface CollisionInput {
  kalshiTicker: string;
  kalshiEventTicker: string;
  polymarketId: string;
}

export interface CollisionGroup {
  polymarketId: string;
  eventTicker: string;
  kalshiTickers: string[];
}

/**
 * Detect (polymarket_id, kalshi event_ticker) collisions: pairs where 2+
 * Kalshi tickers from the same event_ticker prefix all map to the same
 * Polymarket market. These are N parallel candidate binaries collapsing
 * onto one binary — definitionally not the same proposition.
 *
 * Returns the colliding groups (for logging) and a Set of dropped pair
 * keys formatted as "kalshiTicker::polymarketId".
 */
export function detectCollisions(items: CollisionInput[]): {
  collisionGroups: CollisionGroup[];
  droppedPairKeys: Set<string>;
} {
  const groups = new Map<string, CollisionInput[]>();
  for (const item of items) {
    const k = `${item.polymarketId}::${item.kalshiEventTicker}`;
    let arr = groups.get(k);
    if (!arr) {
      arr = [];
      groups.set(k, arr);
    }
    arr.push(item);
  }

  const collisionGroups: CollisionGroup[] = [];
  const droppedPairKeys = new Set<string>();

  for (const group of groups.values()) {
    if (group.length >= 2) {
      collisionGroups.push({
        polymarketId: group[0].polymarketId,
        eventTicker: group[0].kalshiEventTicker,
        kalshiTickers: group.map((g) => g.kalshiTicker),
      });
      for (const g of group) {
        droppedPairKeys.add(`${g.kalshiTicker}::${g.polymarketId}`);
      }
    }
  }

  return { collisionGroups, droppedPairKeys };
}

/**
 * Find potential market pair matches between Kalshi and Polymarket markets.
 * 
 * Uses an inverted index approach for efficiency:
 * 1. Build token index over Polymarket markets
 * 2. For each Kalshi market, find Polymarket candidates that share at least N tokens
 * 3. Score only the candidate pairs (instead of all N×M pairs)
 */
export function findMatches(
  kalshiMarkets: KalshiMarket[],
  polymarketMarkets: PolymarketMarket[],
  minConfidence = 0.35,
): MatchCandidate[] {
  logger.info(`Matching ${kalshiMarkets.length} Kalshi × ${polymarketMarkets.length} Polymarket markets`);
  const startTime = Date.now();

  // Pre-process Polymarket markets
  const polyIndexed: IndexedMarket[] = polymarketMarkets.map((pm, i) => {
    const text = pm.question + (pm.eventTitle ? ' ' + pm.eventTitle : '');
    return { index: i, tokens: extractTokens(text), text };
  });

  // Build inverted index over Polymarket tokens
  const invertedIndex = buildInvertedIndex(polyIndexed);

  const candidates: MatchCandidate[] = [];
  let pairsScored = 0;

  // Minimum shared tokens to even consider a pair
  const MIN_SHARED_TOKENS = 2;

  for (const km of kalshiMarkets) {
    const kalshiText = km.title + (km.subtitle ? ' ' + km.subtitle : '');
    const kalshiTokens = extractTokens(kalshiText);

    if (kalshiTokens.size === 0) continue;

    // Find candidate Polymarket markets via inverted index
    // Count how many tokens each Poly market shares with this Kalshi market
    const candidateCounts = new Map<number, number>();
    for (const token of kalshiTokens) {
      const polyIndices = invertedIndex.get(token);
      if (polyIndices) {
        for (const idx of polyIndices) {
          candidateCounts.set(idx, (candidateCounts.get(idx) || 0) + 1);
        }
      }
    }

    // Only score pairs with enough shared tokens
    let bestMatch: MatchCandidate | null = null;

    for (const [polyIdx, sharedCount] of candidateCounts) {
      if (sharedCount < MIN_SHARED_TOKENS) continue;

      const polyM = polyIndexed[polyIdx];
      const confidence = tokenSimilarity(kalshiTokens, polyM.tokens);
      pairsScored++;

      if (confidence >= minConfidence) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = {
            kalshiMarket: km,
            polymarketMarket: polymarketMarkets[polyIdx],
            confidence,
          };
        }
      }
    }

    if (bestMatch) {
      candidates.push(bestMatch);
    }
  }

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);

  // Drop multi-candidate collisions (PLAN step 2.5):
  // 2+ Kalshi tickers sharing the same event_ticker that all picked the
  // same Polymarket market are structurally not the same proposition.
  const { collisionGroups, droppedPairKeys } = detectCollisions(
    candidates.map((c) => ({
      kalshiTicker: c.kalshiMarket.ticker,
      kalshiEventTicker: c.kalshiMarket.event_ticker,
      polymarketId: c.polymarketMarket.id,
    })),
  );

  if (collisionGroups.length > 0) {
    logger.warn(
      `Dropping ${droppedPairKeys.size} candidates from ${collisionGroups.length} multi-candidate event/poly collisions`,
    );
    for (const g of collisionGroups) {
      logger.warn(
        `  Collision: polymarket=${g.polymarketId} event=${g.eventTicker} kalshi_tickers=[${g.kalshiTickers.join(', ')}]`,
      );
    }
  }

  const filtered = candidates.filter(
    (c) => !droppedPairKeys.has(`${c.kalshiMarket.ticker}::${c.polymarketMarket.id}`),
  );

  const elapsed = Date.now() - startTime;
  logger.info(
    `Found ${filtered.length} match candidates after collision filter ` +
      `(scored ${pairsScored} pairs, dropped ${candidates.length - filtered.length}, ${elapsed}ms)`,
  );

  // Log top matches for visibility
  for (const c of filtered.slice(0, 20)) {
    logger.info(
      `  Match (${(c.confidence * 100).toFixed(1)}%): "${c.kalshiMarket.title}" ↔ "${c.polymarketMarket.question}"`
    );
  }

  return filtered;
}

/**
 * Convert match candidates to MarketPair objects for storage.
 */
export function candidatesToPairs(candidates: MatchCandidate[]): MarketPair[] {
  const now = new Date().toISOString();
  return candidates.map((c) => ({
    id: crypto.randomUUID(),
    kalshiTicker: c.kalshiMarket.ticker,
    polymarketId: c.polymarketMarket.id,
    matchConfidence: c.confidence,
    resolutionDivergenceRisk: 0,
    matchMethod: 'string_similarity' as const,
    status: 'pending_review' as const,
    notes: `Auto-matched: "${c.kalshiMarket.title}" ↔ "${c.polymarketMarket.question}" (score: ${c.confidence.toFixed(3)})`,
    createdAt: now,
    updatedAt: now,
  }));
}
