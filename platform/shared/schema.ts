import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Creators (developers who publish agents) ───

export const creators = sqliteTable("creators", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  verified: integer("verified", { mode: "boolean" }).default(false),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ─── Agents (published AI agents/tools) ───

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => creators.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  longDescription: text("long_description"),
  category: text("category").notNull(), // 'trading', 'analysis', 'data', 'automation'
  tags: text("tags"), // JSON array
  endpointUrl: text("endpoint_url").notNull(),
  healthCheckUrl: text("health_check_url"),
  docsUrl: text("docs_url"),
  pricing: text("pricing").notNull().default("free"), // 'free', 'usage', 'monthly'
  pricePerCall: real("price_per_call").default(0),
  monthlyPrice: real("monthly_price").default(0),
  status: text("status").notNull().default("draft"), // 'draft', 'active', 'suspended'
  rateLimit: integer("rate_limit").default(100), // requests per minute
  version: text("version").default("1.0.0"),
  schema: text("schema"), // JSON schema for agent input/output
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// ─── API Keys (for consumers) ───

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => creators.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(), // hashed, never stored raw
  prefix: text("prefix").notNull(), // first 8 chars for identification
  scopes: text("scopes").default("read"), // comma-separated
  lastUsedAt: text("last_used_at"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ─── Subscriptions (user subscribes to agent) ───

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => creators.id),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  status: text("status").notNull().default("active"), // 'active', 'paused', 'cancelled'
  plan: text("plan").notNull().default("free"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ─── Usage Logs (API call tracking) ───

export const usageLogs = sqliteTable("usage_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  apiKeyId: text("api_key_id")
    .notNull()
    .references(() => apiKeys.id),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ─── Reviews ───

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => creators.id),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  rating: integer("rating").notNull(), // 1-5
  comment: text("comment"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// ─── Type exports ───

export type Creator = typeof creators.$inferSelect;
export type NewCreator = typeof creators.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type UsageLog = typeof usageLogs.$inferSelect;
export type Review = typeof reviews.$inferSelect;
