import { Hono } from "hono";
import { eq, and, desc, sql, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import {
  agents,
  creators,
  subscriptions,
  reviews,
} from "../../shared/schema.js";
import { requireAuth } from "../middleware/auth.js";
import type { PublishAgentRequest } from "../../shared/types.js";

const agentsRouter = new Hono();

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
