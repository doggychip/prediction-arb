import crypto from 'crypto';
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
  marketA: PolymarketMarket;
  marketB: PolymarketMarket;
  confidence: number;
}

/**
 * Find potential matching markets within a set of Polymarket markets.
 *
 * Uses an inverted index approach for efficiency:
 * 1. Build token index over markets
 * 2. For each market, find candidates that share at least N tokens
 * 3. Score only the candidate pairs
 */
export function findMatches(
  markets: PolymarketMarket[],
  minConfidence = 0.35,
): MatchCandidate[] {
  logger.info(`Matching among ${markets.length} Polymarket markets`);
  const startTime = Date.now();

  const indexed: IndexedMarket[] = markets.map((pm, i) => {
    const text = pm.question + (pm.eventTitle ? ' ' + pm.eventTitle : '');
    return { index: i, tokens: extractTokens(text), text };
  });

  const invertedIndex = buildInvertedIndex(indexed);

  const candidates: MatchCandidate[] = [];
  let pairsScored = 0;
  const MIN_SHARED_TOKENS = 2;
  const seen = new Set<string>();

  for (let i = 0; i < markets.length; i++) {
    const mA = indexed[i];
    if (mA.tokens.size === 0) continue;

    const candidateCounts = new Map<number, number>();
    for (const token of mA.tokens) {
      const indices = invertedIndex.get(token);
      if (indices) {
        for (const idx of indices) {
          if (idx <= i) continue; // avoid duplicates and self-match
          candidateCounts.set(idx, (candidateCounts.get(idx) || 0) + 1);
        }
      }
    }

    let bestMatch: MatchCandidate | null = null;

    for (const [bIdx, sharedCount] of candidateCounts) {
      if (sharedCount < MIN_SHARED_TOKENS) continue;

      const mB = indexed[bIdx];
      const confidence = tokenSimilarity(mA.tokens, mB.tokens);
      pairsScored++;

      if (confidence >= minConfidence) {
        const key = `${markets[i].id}:${markets[bIdx].id}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = {
              marketA: markets[i],
              marketB: markets[bIdx],
              confidence,
            };
          }
        }
      }
    }

    if (bestMatch) {
      candidates.push(bestMatch);
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const elapsed = Date.now() - startTime;
  logger.info(
    `Found ${candidates.length} match candidates (scored ${pairsScored} pairs in ${elapsed}ms)`
  );

  for (const c of candidates.slice(0, 20)) {
    logger.info(
      `  Match (${(c.confidence * 100).toFixed(1)}%): "${c.marketA.question}" ↔ "${c.marketB.question}"`
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
    polymarketId: c.marketA.id,
    matchConfidence: c.confidence,
    resolutionDivergenceRisk: 0,
    matchMethod: 'string_similarity' as const,
    status: 'pending_review' as const,
    notes: `Auto-matched: "${c.marketA.question}" ↔ "${c.marketB.question}" (score: ${c.confidence.toFixed(3)})`,
    createdAt: now,
    updatedAt: now,
  }));
}
