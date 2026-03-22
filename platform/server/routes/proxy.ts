import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "../db/index.js";
import {
  apiKeys,
  agents,
  subscriptions,
  usageLogs,
} from "../../shared/schema.js";

const proxyRouter = new Hono();

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// POST /call/:slug — proxy a call to an agent's endpoint
// Authenticated via X-API-Key header
proxyRouter.post("/:slug", async (c) => {
  const rawKey = c.req.header("X-API-Key");
  if (!rawKey) {
    return c.json({ error: "Missing X-API-Key header", code: "UNAUTHORIZED" }, 401);
  }

  const start = Date.now();
  const slug = c.req.param("slug");

  // 1. Validate API key
  const keyRecord = db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashKey(rawKey)))
    .get();

  if (!keyRecord) {
    return c.json({ error: "Invalid API key", code: "UNAUTHORIZED" }, 401);
  }

  // Update last used
  db.update(apiKeys)
    .set({ lastUsedAt: sql`datetime('now')` })
    .where(eq(apiKeys.id, keyRecord.id))
    .run();

  // 2. Find agent
  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.slug, slug), eq(agents.status, "active")))
    .get();

  if (!agent) {
    return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404);
  }

  // 3. Check subscription
  const sub = db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, keyRecord.userId),
        eq(subscriptions.agentId, agent.id),
        eq(subscriptions.status, "active")
      )
    )
    .get();

  if (!sub && agent.pricing !== "free") {
    return c.json(
      { error: "Active subscription required", code: "FORBIDDEN" },
      403
    );
  }

  // 4. Rate limiting (simple per-minute check)
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const recentCalls = db
    .select({ count: sql<number>`count(*)` })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.apiKeyId, keyRecord.id),
        eq(usageLogs.agentId, agent.id),
        sql`${usageLogs.createdAt} > ${oneMinuteAgo}`
      )
    )
    .get();

  if ((recentCalls?.count || 0) >= (agent.rateLimit || 100)) {
    return c.json({ error: "Rate limit exceeded", code: "RATE_LIMITED" }, 429);
  }

  // 5. Forward request to agent endpoint
  let agentResponse: Response;
  let statusCode: number;

  try {
    const body = await c.req.json().catch(() => ({}));
    agentResponse = await fetch(agent.endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    statusCode = agentResponse.status;
  } catch (err) {
    const latencyMs = Date.now() - start;

    db.insert(usageLogs)
      .values({
        apiKeyId: keyRecord.id,
        agentId: agent.id,
        method: "POST",
        path: `/call/${slug}`,
        statusCode: 502,
        latencyMs,
      })
      .run();

    return c.json(
      { error: "Agent endpoint unreachable", code: "BAD_GATEWAY" },
      502
    );
  }

  const latencyMs = Date.now() - start;

  // 6. Log usage
  db.insert(usageLogs)
    .values({
      apiKeyId: keyRecord.id,
      agentId: agent.id,
      method: "POST",
      path: `/call/${slug}`,
      statusCode,
      latencyMs,
    })
    .run();

  // 7. Return agent response
  const output = await agentResponse.json().catch(() => null);

  return c.json({
    output,
    latencyMs,
    status: statusCode,
  });
});

export default proxyRouter;
