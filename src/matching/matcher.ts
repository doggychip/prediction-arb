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
 * Compute the Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use a flat array for the DP table (space-optimized)
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Compute normalized Levenshtein similarity (0 to 1, where 1 is identical).
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Token-based Jaccard similarity: ratio of shared words.
 */
function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Combined similarity score using both Levenshtein and token similarity.
 */
function combinedSimilarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);

  const levSim = levenshteinSimilarity(normA, normB);
  const tokSim = tokenSimilarity(normA, normB);

  // Weight token similarity higher since market titles often differ in phrasing
  return 0.4 * levSim + 0.6 * tokSim;
}

export interface MatchCandidate {
  kalshiMarket: KalshiMarket;
  polymarketMarket: PolymarketMarket;
  confidence: number;
}

/**
 * Find potential market pair matches between Kalshi and Polymarket markets.
 * Uses string similarity as a placeholder — LLM matching comes in Phase 1.5.
 */
export function findMatches(
  kalshiMarkets: KalshiMarket[],
  polymarketMarkets: PolymarketMarket[],
  minConfidence = 0.5,
): MatchCandidate[] {
  logger.info(`Matching ${kalshiMarkets.length} Kalshi × ${polymarketMarkets.length} Polymarket markets`);

  const candidates: MatchCandidate[] = [];

  for (const km of kalshiMarkets) {
    const kalshiText = km.title + (km.subtitle ? ' ' + km.subtitle : '');

    let bestMatch: MatchCandidate | null = null;

    for (const pm of polymarketMarkets) {
      const polyText = pm.question + (pm.eventTitle ? ' ' + pm.eventTitle : '');
      const confidence = combinedSimilarity(kalshiText, polyText);

      if (confidence >= minConfidence) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = {
            kalshiMarket: km,
            polymarketMarket: pm,
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

  logger.info(`Found ${candidates.length} match candidates above ${minConfidence} confidence`);
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
