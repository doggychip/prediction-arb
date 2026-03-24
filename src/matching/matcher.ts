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
  'will',
  'the',
  'be',
  'a',
  'an',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'by',
  'is',
  'it',
  'or',
  'and',
  'with',
  'this',
  'that',
  'what',
  'how',
  'does',
  'do',
  'than',
  'more',
  'less',
  'above',
  'below',
  'over',
  'under',
  'before',
  'after',
  'yes',
  'no',
  'between',
]);

function extractTokens(text: string): Set<string> {
  const normalized = normalize(text);
  const tokens = normalized.split(' ').filter((t) => t.length > 1 && !STOP_WORDS.has(t));
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
  const [smaller, larger] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];

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
  logger.info(
    `Matching ${kalshiMarkets.length} Kalshi × ${polymarketMarkets.length} Polymarket markets`,
  );
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

  const elapsed = Date.now() - startTime;
  logger.info(
    `Found ${candidates.length} match candidates (scored ${pairsScored} pairs in ${elapsed}ms)`,
  );

  // Log top matches for visibility
  for (const c of candidates.slice(0, 20)) {
    logger.info(
      `  Match (${(c.confidence * 100).toFixed(1)}%): "${c.kalshiMarket.title}" ↔ "${c.polymarketMarket.question}"`,
    );
  }

  return candidates;
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
