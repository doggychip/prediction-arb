import { Hono } from "hono";
import { eq, and, desc, sql, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import {
  agents,
  creators,
  subscriptions,
  reviews,
  usageLogs,
} from "../../shared/schema.js";
import { requireAuth } from "../middleware/auth.js";
import type { PublishAgentRequest } from "../../shared/types.js";

const agentsRouter = new Hono();

// GET /agents/mine — list agents owned by the current user
agentsRouter.get("/mine", requireAuth, async (c) => {
  const userId = c.get("userId");

  const results = db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      description: agents.description,
      category: agents.category,
      tags: agents.tags,
      pricing: agents.pricing,
      pricePerCall: agents.pricePerCall,
      monthlyPrice: agents.monthlyPrice,
      status: agents.status,
      healthStatus: agents.healthStatus,
      healthCheckedAt: agents.healthCheckedAt,
      version: agents.version,
      createdAt: agents.createdAt,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .where(eq(agents.creatorId, userId))
    .orderBy(desc(agents.createdAt))
    .all();

  const enriched = results.map((agent) => {
    const subCount = db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.agentId, agent.id),
          eq(subscriptions.status, "active")
        )
      )
      .get();

    const callCount = db
      .select({ count: sql<number>`count(*)` })
      .from(usageLogs)
      .where(eq(usageLogs.agentId, agent.id))
      .get();

    return {
      ...agent,
      tags: agent.tags ? JSON.parse(agent.tags) : [],
      subscriberCount: subCount?.count || 0,
      totalCalls: callCount?.count || 0,
    };
  });

  return c.json({ agents: enriched });
});

// GET /agents/mine/:slug/usage — usage stats for an agent owned by the current user
agentsRouter.get("/mine/:slug/usage", requireAuth, async (c) => {
  const userId = c.get("userId");
  const slug = c.req.param("slug");

  const agent = db
    .select()
    .from(agents)
    .where(and(eq(agents.slug, slug), eq(agents.creatorId, userId)))
    .get();

  if (!agent) {
    return c.json({ error: "Agent not found or not owned by you", code: "NOT_FOUND" }, 404);
  }

  // Total calls
  const totalCalls = db
    .select({ count: sql<number>`count(*)` })
    .from(usageLogs)
    .where(eq(usageLogs.agentId, agent.id))
    .get();

  // Calls last 24h
  const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const calls24h = db
    .select({ count: sql<number>`count(*)` })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.agentId, agent.id),
        sql`${usageLogs.createdAt} > ${oneDayAgo}`
      )
    )
    .get();

  // Calls last 7d
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const calls7d = db
    .select({ count: sql<number>`count(*)` })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.agentId, agent.id),
        sql`${usageLogs.createdAt} > ${sevenDaysAgo}`
      )
    )
    .get();

  // Avg latency
  const avgLatency = db
    .select({ avg: sql<number>`avg(latency_ms)` })
    .from(usageLogs)
    .where(eq(usageLogs.agentId, agent.id))
    .get();

  // Error rate (non-2xx)
  const errorCount = db
    .select({ count: sql<number>`count(*)` })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.agentId, agent.id),
        sql`${usageLogs.statusCode} >= 400`
      )
    )
    .get();

  // Daily breakdown (last 7 days)
  const dailyBreakdown = db
    .select({
      date: sql<string>`date(${usageLogs.createdAt})`.as("date"),
      count: sql<number>`count(*)`.as("count"),
      avgLatency: sql<number>`avg(latency_ms)`.as("avg_latency"),
      errors: sql<number>`sum(case when ${usageLogs.statusCode} >= 400 then 1 else 0 end)`.as("errors"),
    })
    .from(usageLogs)
    .where(
      and(
        eq(usageLogs.agentId, agent.id),
        sql`${usageLogs.createdAt} > ${sevenDaysAgo}`
      )
    )
    .groupBy(sql`date(${usageLogs.createdAt})`)
    .orderBy(sql`date(${usageLogs.createdAt})`)
    .all();

  // Revenue estimate
  const revenue = (totalCalls?.count || 0) * (agent.pricePerCall || 0);

  return c.json({
    agentId: agent.id,
    slug: agent.slug,
    totalCalls: totalCalls?.count || 0,
    calls24h: calls24h?.count || 0,
    calls7d: calls7d?.count || 0,
    avgLatencyMs: avgLatency?.avg ? Math.round(avgLatency.avg) : 0,
    errorRate: totalCalls?.count
      ? Math.round(((errorCount?.count || 0) / totalCalls.count) * 100)
      : 0,
    estimatedRevenue: Math.round(revenue * 100) / 100,
    daily: dailyBreakdown,
  });
});

// PATCH /agents/:slug/status — activate, suspend, or delete an agent
agentsRouter.patch("/:slug/status", requireAuth, async (c) => {
  const userId = c.get("userId");
  const slug = c.req.param("slug");

  const existing = db
    .select()
    .from(agents)
    .where(eq(agents.slug, slug))
    .get();

  if (!existing) {
    return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404);
  }

  if (existing.creatorId !== userId) {
    return c.json({ error: "Not authorized", code: "FORBIDDEN" }, 403);
  }

  const { status } = await c.req.json<{ status: string }>();

  if (!["active", "suspended"].includes(status)) {
    return c.json({ error: "Status must be 'active' or 'suspended'", code: "VALIDATION" }, 400);
  }

  db.update(agents)
    .set({ status, updatedAt: sql`datetime('now')` })
    .where(eq(agents.id, existing.id))
    .run();

  return c.json({ ok: true, status });
});

// DELETE /agents/:slug — delete an agent (owner only)
agentsRouter.delete("/:slug", requireAuth, async (c) => {
  const userId = c.get("userId");
  const slug = c.req.param("slug");

  const existing = db
    .select()
    .from(agents)
    .where(eq(agents.slug, slug))
    .get();

  if (!existing) {
    return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404);
  }

  if (existing.creatorId !== userId) {
    return c.json({ error: "Not authorized", code: "FORBIDDEN" }, 403);
  }

  // Cancel active subscriptions first
  db.update(subscriptions)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(subscriptions.agentId, existing.id),
        eq(subscriptions.status, "active")
      )
    )
    .run();

  // Delete agent
  db.delete(agents).where(eq(agents.id, existing.id)).run();

  return c.json({ ok: true });
});

// GET /agents — list/search agents
agentsRouter.get("/", async (c) => {
  const category = c.req.query("category");
  const search = c.req.query("q");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  let query = db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      description: agents.description,
      category: agents.category,
      tags: agents.tags,
      pricing: agents.pricing,
      pricePerCall: agents.pricePerCall,
      monthlyPrice: agents.monthlyPrice,
      status: agents.status,
      healthStatus: agents.healthStatus,
      version: agents.version,
      createdAt: agents.createdAt,
      creatorId: creators.id,
      creatorName: creators.name,
      creatorVerified: creators.verified,
    })
    .from(agents)
    .innerJoin(creators, eq(agents.creatorId, creators.id))
    .where(eq(agents.status, "active"))
    .orderBy(desc(agents.createdAt))
    .limit(limit)
    .offset(offset);

  // Apply filters
  if (category) {
    query = query.where(
      and(eq(agents.status, "active"), eq(agents.category, category))
    ) as typeof query;
  }

  if (search) {
    query = query.where(
      and(eq(agents.status, "active"), like(agents.name, `%${search}%`))
    ) as typeof query;
  }

  const results = query.all();

  // Enrich with subscriber count and avg rating
  const enriched = results.map((agent) => {
    const subCount = db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.agentId, agent.id),
          eq(subscriptions.status, "active")
        )
      )
      .get();

    const ratingInfo = db
      .select({
        avg: sql<number>`avg(rating)`,
        count: sql<number>`count(*)`,
      })
      .from(reviews)
      .where(eq(reviews.agentId, agent.id))
      .get();

    return {
      ...agent,
      tags: agent.tags ? JSON.parse(agent.tags) : [],
      creator: {
        id: agent.creatorId,
        name: agent.creatorName,
        verified: agent.creatorVerified,
      },
      subscriberCount: subCount?.count || 0,
      avgRating: ratingInfo?.avg ? Math.round(ratingInfo.avg * 10) / 10 : 0,
      reviewCount: ratingInfo?.count || 0,
    };
  });

  return c.json({ agents: enriched, total: enriched.length });
});

// GET /agents/:slug — agent detail
agentsRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug");

  const agent = db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      description: agents.description,
      longDescription: agents.longDescription,
      category: agents.category,
      tags: agents.tags,
      endpointUrl: agents.endpointUrl,
      docsUrl: agents.docsUrl,
      pricing: agents.pricing,
      pricePerCall: agents.pricePerCall,
      monthlyPrice: agents.monthlyPrice,
      status: agents.status,
      healthStatus: agents.healthStatus,
      healthCheckedAt: agents.healthCheckedAt,
      rateLimit: agents.rateLimit,
      version: agents.version,
      schema: agents.schema,
      createdAt: agents.createdAt,
      creatorId: creators.id,
      creatorName: creators.name,
      creatorBio: creators.bio,
      creatorVerified: creators.verified,
    })
    .from(agents)
    .innerJoin(creators, eq(agents.creatorId, creators.id))
    .where(eq(agents.slug, slug))
    .get();

  if (!agent) {
    return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404);
  }

  const subCount = db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.agentId, agent.id),
        eq(subscriptions.status, "active")
      )
    )
    .get();

  const agentReviews = db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      createdAt: reviews.createdAt,
      userName: creators.name,
    })
    .from(reviews)
    .innerJoin(creators, eq(reviews.userId, creators.id))
    .where(eq(reviews.agentId, agent.id))
    .orderBy(desc(reviews.createdAt))
    .limit(20)
    .all();

  return c.json({
    ...agent,
    tags: agent.tags ? JSON.parse(agent.tags) : [],
    schema: agent.schema ? JSON.parse(agent.schema) : null,
    creator: {
      id: agent.creatorId,
      name: agent.creatorName,
      bio: agent.creatorBio,
      verified: agent.creatorVerified,
    },
    subscriberCount: subCount?.count || 0,
    reviews: agentReviews,
  });
});

// POST /agents — publish a new agent (auth required)
agentsRouter.post("/", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<PublishAgentRequest>();

  if (!body.name || !body.slug || !body.description || !body.endpointUrl) {
    return c.json(
      { error: "Missing required fields", code: "VALIDATION" },
      400
    );
  }

  // Check slug uniqueness
  const existing = db
    .select()
    .from(agents)
    .where(eq(agents.slug, body.slug))
    .get();

  if (existing) {
    return c.json({ error: "Slug already taken", code: "CONFLICT" }, 409);
  }

  const id = nanoid();

  db.insert(agents)
    .values({
      id,
      creatorId: userId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      longDescription: body.longDescription,
      category: body.category || "other",
      tags: body.tags ? JSON.stringify(body.tags) : null,
      endpointUrl: body.endpointUrl,
      healthCheckUrl: body.healthCheckUrl,
      docsUrl: body.docsUrl,
      pricing: body.pricing || "free",
      pricePerCall: body.pricePerCall || 0,
      monthlyPrice: body.monthlyPrice || 0,
      rateLimit: body.rateLimit || 100,
      schema: body.schema ? JSON.stringify(body.schema) : null,
      status: "active",
    })
    .run();

  return c.json({ id, slug: body.slug, status: "active" }, 201);
});

// PATCH /agents/:slug — update agent (auth required, owner only)
agentsRouter.patch("/:slug", requireAuth, async (c) => {
  const userId = c.get("userId");
  const slug = c.req.param("slug");

  const existing = db
    .select()
    .from(agents)
    .where(eq(agents.slug, slug))
    .get();

  if (!existing) {
    return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404);
  }

  if (existing.creatorId !== userId) {
    return c.json({ error: "Not authorized", code: "FORBIDDEN" }, 403);
  }

  const body = await c.req.json<Partial<PublishAgentRequest>>();

  const updates: Record<string, unknown> = {};
  if (body.name) updates.name = body.name;
  if (body.description) updates.description = body.description;
  if (body.longDescription) updates.longDescription = body.longDescription;
  if (body.category) updates.category = body.category;
  if (body.tags) updates.tags = JSON.stringify(body.tags);
  if (body.endpointUrl) updates.endpointUrl = body.endpointUrl;
  if (body.healthCheckUrl) updates.healthCheckUrl = body.healthCheckUrl;
  if (body.docsUrl) updates.docsUrl = body.docsUrl;
  if (body.pricing) updates.pricing = body.pricing;
  if (body.pricePerCall !== undefined) updates.pricePerCall = body.pricePerCall;
  if (body.monthlyPrice !== undefined) updates.monthlyPrice = body.monthlyPrice;
  if (body.rateLimit) updates.rateLimit = body.rateLimit;
  if (body.schema) updates.schema = JSON.stringify(body.schema);

  if (Object.keys(updates).length > 0) {
    db.update(agents)
      .set({ ...updates, updatedAt: sql`datetime('now')` })
      .where(eq(agents.id, existing.id))
      .run();
  }

  return c.json({ ok: true });
});

export default agentsRouter;
