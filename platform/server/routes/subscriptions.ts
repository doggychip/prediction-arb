import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { subscriptions, agents, creators } from "../../shared/schema.js";
import { requireAuth } from "../middleware/auth.js";

const subsRouter = new Hono();

// GET /subscriptions — list my subscriptions
subsRouter.get("/", requireAuth, async (c) => {
  const userId = c.get("userId");

  const results = db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      plan: subscriptions.plan,
      createdAt: subscriptions.createdAt,
      agentId: agents.id,
      agentName: agents.name,
      agentSlug: agents.slug,
      agentDescription: agents.description,
      agentPricing: agents.pricing,
    })
    .from(subscriptions)
    .innerJoin(agents, eq(subscriptions.agentId, agents.id))
    .where(eq(subscriptions.userId, userId))
    .all();

  return c.json({ subscriptions: results });
});

// POST /subscriptions — subscribe to an agent
subsRouter.post("/", requireAuth, async (c) => {
  const userId = c.get("userId");
  const { agentId } = await c.req.json<{ agentId: string }>();

  if (!agentId) {
    return c.json({ error: "agentId required", code: "VALIDATION" }, 400);
  }

  // Check agent exists
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent || agent.status !== "active") {
    return c.json({ error: "Agent not found or inactive", code: "NOT_FOUND" }, 404);
  }

  // Check for existing active subscription
  const existing = db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.agentId, agentId),
        eq(subscriptions.status, "active")
      )
    )
    .get();

  if (existing) {
    return c.json({ error: "Already subscribed", code: "CONFLICT" }, 409);
  }

  const id = nanoid();
  db.insert(subscriptions)
    .values({ id, userId, agentId, plan: agent.pricing })
    .run();

  return c.json({ id, status: "active" }, 201);
});

// DELETE /subscriptions/:id — cancel subscription
subsRouter.delete("/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const sub = db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)))
    .get();

  if (!sub) {
    return c.json({ error: "Subscription not found", code: "NOT_FOUND" }, 404);
  }

  db.update(subscriptions)
    .set({ status: "cancelled" })
    .where(eq(subscriptions.id, id))
    .run();

  return c.json({ ok: true });
});

export default subsRouter;
