import { z } from 'zod';
import { createLogger } from './logger.js';

const logger = createLogger('validation');

// --- Kalshi API Schemas ---

export const KalshiMarketSchema = z
  .object({
    ticker: z.string(),
    event_ticker: z.string(),
    title: z.string(),
    subtitle: z.string().default(''),
    status: z.string(),
    market_type: z.string().default(''),

    yes_bid_dollars: z.string().default('0'),
    yes_ask_dollars: z.string().default('0'),
    no_bid_dollars: z.string().default('0'),
    no_ask_dollars: z.string().default('0'),
    last_price_dollars: z.string().default('0'),
    notional_value_dollars: z.string().default('1.00'),

    volume_fp: z.string().default('0'),
    volume_24h_fp: z.string().default('0'),
    open_interest_fp: z.string().default('0'),
    liquidity_dollars: z.string().default('0'),

    yes_bid_size_fp: z.string().default('0'),
    yes_ask_size_fp: z.string().default('0'),

    rules_primary: z.string().default(''),
    rules_secondary: z.string().default(''),
    close_time: z.string().default(''),
    open_time: z.string().default(''),
    expiration_time: z.string().default(''),
    expected_expiration_time: z.string().default(''),

    result: z.string().default(''),
    expiration_value: z.string().default(''),

    mve_collection_ticker: z.string().optional(),
    mve_selected_legs: z.array(z.unknown()).optional(),

    tick_size: z.number().default(1),
    settlement_timer_seconds: z.number().default(0),
    can_close_early: z.boolean().default(false),
    response_price_units: z.string().default(''),
    yes_sub_title: z.string().default(''),
    no_sub_title: z.string().default(''),
    strike_type: z.string().default(''),
  })
  .passthrough();

export const KalshiMarketsResponseSchema = z.object({
  markets: z.array(KalshiMarketSchema),
  cursor: z.string().default(''),
});

export const KalshiMarketResponseSchema = z.object({
  market: KalshiMarketSchema,
});

export const KalshiWsTickerMsgSchema = z.object({
  market_ticker: z.string(),
  yes_bid_dollars: z.string().optional(),
  yes_ask_dollars: z.string().optional(),
  no_bid_dollars: z.string().optional(),
  no_ask_dollars: z.string().optional(),
  last_price_dollars: z.string().optional(),
  volume_fp: z.string().optional(),
});

export const KalshiWsMessageSchema = z
  .object({
    type: z.string(),
    msg: z.record(z.unknown()).optional(),
  })
  .passthrough();

// --- Polymarket API Schemas ---

export const PolymarketMarketSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    conditionId: z.string().default(''),
    slug: z.string().default(''),
    outcomes: z.string().default('[]'),
    outcomePrices: z.string().default('[]'),
    volume: z.string().default('0'),
    volume24hr: z.number().default(0),
    liquidity: z.string().default('0'),
    active: z.boolean().default(false),
    closed: z.boolean().default(false),
    clobTokenIds: z.string().default('[]'),
    enableOrderBook: z.boolean().default(false),
    description: z.string().default(''),
    endDate: z.string().default(''),
    tags: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          slug: z.string(),
        }),
      )
      .default([]),
    neg_risk: z.boolean().default(false),
    eventSlug: z.string().default(''),
    eventTitle: z.string().default(''),
  })
  .passthrough();

export const PolymarketWsEventSchema = z
  .object({
    event_type: z.string(),
    asset_id: z.string().optional(),
  })
  .passthrough();

// --- JSON.parse helpers ---

/**
 * Safely parse a JSON string with Zod validation.
 * Returns the validated result or a default value on failure.
 */
export function safeJsonParse<T>(
  raw: string,
  schema: z.ZodType<T>,
  context: string,
  defaultValue: T,
): T {
  try {
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    logger.warn(`Validation failed for ${context}: ${result.error.message}`);
    return defaultValue;
  } catch (err) {
    logger.warn(`JSON parse failed for ${context}: ${(err as Error).message}`);
    return defaultValue;
  }
}

/**
 * Validate an already-parsed object with Zod.
 * Returns the validated result or a default value on failure.
 */
export function safeValidate<T>(data: unknown, schema: z.ZodType<T>, context: string): T | null {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  logger.warn(`Validation failed for ${context}: ${result.error.message}`);
  return null;
}

// Schema for parsing clobTokenIds and outcomePrices arrays
export const StringArraySchema = z.array(z.string());
