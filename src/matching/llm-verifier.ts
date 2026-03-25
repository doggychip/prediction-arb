import { z } from 'zod';
import type { Config } from '../config.js';
import type { MatchCandidate } from './matcher.js';
import { createLogger } from '../logger.js';

const logger = createLogger('llm-verifier');

/** LLM verification result for a single candidate pair */
export interface LlmVerification {
  /** Whether the LLM considers this a valid match */
  isMatch: boolean;
  /** LLM-adjusted confidence (0-1) */
  confidence: number;
  /** Whether the YES/NO polarity is inverted between platforms */
  polarityInverted: boolean;
  /** Brief reasoning from the LLM */
  reasoning: string;
}

/** A match candidate enriched with LLM verification */
export interface VerifiedCandidate extends MatchCandidate {
  llmVerification?: LlmVerification;
}

const LlmResponseSchema = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      is_match: z.boolean(),
      confidence: z.number().min(0).max(1),
      polarity_inverted: z.boolean(),
      reasoning: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You are an expert at prediction markets. Your job is to determine whether two prediction market listings from different platforms (Kalshi and Polymarket) refer to the SAME underlying event/question.

Key considerations:
- Markets must resolve on the same condition to be a valid match
- Watch for subtle differences: different dates, thresholds, or scope
- Check if YES on one platform means YES on the other (polarity)
- "Will X happen?" and "X to happen" are the same question
- Different wording for the same event is still a match
- Markets about the same topic but different specific questions are NOT matches

Respond with a JSON object containing a "results" array. Each result has:
- index: the pair's index in the input
- is_match: true if the markets refer to the same resolvable question
- confidence: 0.0-1.0 how confident you are they match
- polarity_inverted: true if YES on Kalshi = NO on Polymarket
- reasoning: one sentence explaining your judgment`;

function buildUserPrompt(candidates: MatchCandidate[]): string {
  const pairs = candidates.map((c, i) => {
    const kalshiContext = c.kalshiMarket.subtitle
      ? `${c.kalshiMarket.title} (${c.kalshiMarket.subtitle})`
      : c.kalshiMarket.title;
    return `[${i}] Kalshi: "${kalshiContext}" | Polymarket: "${c.polymarketMarket.question}"${c.polymarketMarket.eventTitle ? ` (Event: ${c.polymarketMarket.eventTitle})` : ''}`;
  });

  return `Verify these ${candidates.length} market pair matches:\n\n${pairs.join('\n')}\n\nRespond with JSON only.`;
}

async function callLlm(config: Config, systemPrompt: string, userPrompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs * 2);

  try {
    const response = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`LLM API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || '';
  } finally {
    clearTimeout(timeout);
  }
}

function parseResponse(raw: string, batchSize: number): Map<number, LlmVerification> {
  const results = new Map<number, LlmVerification>();

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  const jsonStr = jsonMatch[1]?.trim() || raw.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const validated = LlmResponseSchema.safeParse(parsed);

    if (!validated.success) {
      logger.warn(`LLM response validation failed: ${validated.error.message}`);
      return results;
    }

    for (const r of validated.data.results) {
      if (r.index >= 0 && r.index < batchSize) {
        results.set(r.index, {
          isMatch: r.is_match,
          confidence: r.confidence,
          polarityInverted: r.polarity_inverted,
          reasoning: r.reasoning,
        });
      }
    }
  } catch (err) {
    logger.error('Failed to parse LLM response as JSON', {
      error: (err as Error).message,
      raw: raw.slice(0, 200),
    });
  }

  return results;
}

/**
 * Verify match candidates using an LLM.
 * Processes candidates in batches and returns verified results.
 * Candidates that fail LLM verification are filtered out.
 * Those without LLM results (API failure) are kept with original confidence.
 */
export async function verifyMatchesWithLlm(
  config: Config,
  candidates: MatchCandidate[],
): Promise<VerifiedCandidate[]> {
  if (!config.llmApiKey || !config.llmVerifyEnabled) {
    logger.info('LLM verification skipped (no API key or disabled)');
    return candidates;
  }

  if (candidates.length === 0) return [];

  const batchSize = config.llmVerifyBatchSize;
  const verified: VerifiedCandidate[] = [];
  let verifiedCount = 0;
  let rejectedCount = 0;
  let errorCount = 0;

  logger.info(`Verifying ${candidates.length} candidates with LLM (batch size: ${batchSize})`);

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const userPrompt = buildUserPrompt(batch);

    try {
      const raw = await callLlm(config, SYSTEM_PROMPT, userPrompt);
      const results = parseResponse(raw, batch.length);

      for (let j = 0; j < batch.length; j++) {
        const candidate = batch[j];
        const verification = results.get(j);

        if (verification) {
          if (verification.isMatch) {
            verified.push({
              ...candidate,
              confidence: verification.confidence,
              llmVerification: verification,
            });
            verifiedCount++;
            logger.info(
              `  LLM verified (${(verification.confidence * 100).toFixed(0)}%): ` +
                `"${candidate.kalshiMarket.title}" ↔ "${candidate.polymarketMarket.question}"` +
                (verification.polarityInverted ? ' [POLARITY INVERTED]' : ''),
            );
          } else {
            rejectedCount++;
            logger.info(
              `  LLM rejected: "${candidate.kalshiMarket.title}" ↔ "${candidate.polymarketMarket.question}" — ${verification.reasoning}`,
            );
          }
        } else {
          // No LLM result for this item — keep with original confidence
          verified.push(candidate);
          errorCount++;
        }
      }
    } catch (err) {
      logger.error(`LLM batch verification failed`, { error: (err as Error).message });
      // On API failure, keep all candidates in this batch with original confidence
      for (const candidate of batch) {
        verified.push(candidate);
        errorCount++;
      }
    }
  }

  logger.info(
    `LLM verification complete: ${verifiedCount} verified, ${rejectedCount} rejected, ${errorCount} unverified (kept)`,
  );

  return verified;
}

// Export for testing
export { buildUserPrompt, parseResponse, SYSTEM_PROMPT };
