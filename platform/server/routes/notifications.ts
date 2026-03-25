import { Hono } from "hono";
import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { db } from "../db/index.js";
import { notifications, webhooks } from "../../shared/schema.js";
import { requireAuth } from "../middleware/auth.js";

const notifRouter = new Hono();

// GET /notifications — list user's notifications
notifRouter.get("/", requireAuth, async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const offset = parseInt(c.req.query("offset") || "0");

  const items = db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  const unread = db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
    .get();

  return c.json({
    notifications: items.map((n) => ({
      ...n,
      metadata: n.metadata ? JSON.parse(n.metadata) : null,
    })),
    unreadCount: unread?.count || 0,
  });
});

// PATCH /notifications/:id/read — mark as read
notifRouter.patch("/:id/read", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  db.update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .run();

  return c.json({ ok: true });
});

// POST /notifications/read-all — mark all as read
notifRouter.post("/read-all", requireAuth, async (c) => {
  const userId = c.get("userId");

  db.update(notifications)
    .set({ read: true })
    .where(eq(notifications.userId, userId))
    .run();

  return c.json({ ok: true });
});

// ─── Webhook management ───

// GET /notifications/webhooks
notifRouter.get("/webhooks", requireAuth, async (c) => {
  const userId = c.get("userId");

  const items = db
    .select()
    .from(webhooks)
    .where(eq(webhooks.userId, userId))
    .all();

  return c.json({
    webhooks: items.map((w) => ({
      ...w,
      events: JSON.parse(w.events),
      secret: undefined, // never expose secret
    })),
  });
});

// POST /notifications/webhooks
notifRouter.post("/webhooks", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ url: string; events: string[] }>();

  if (!body.url || !body.events?.length) {
    return c.json({ error: "url and events required", code: "VALIDATION" }, 400);
  }

  const validEvents = ["subscription.created", "review.created", "health.changed"];
  const invalid = body.events.filter((e) => !validEvents.includes(e));
  if (invalid.length > 0) {
    return c.json({ error: `Invalid events: ${invalid.join(", ")}`, code: "VALIDATION" }, 400);
  }

  const id = nanoid();
  const secret = randomBytes(32).toString("hex");

  db.insert(webhooks)
    .values({
      id,
      userId,
      url: body.url,
      events: JSON.stringify(body.events),
      secret,
    })
    .run();

  return c.json({ id, secret }, 201);
});

// DELETE /notifications/webhooks/:id
notifRouter.delete("/webhooks/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const wh = db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
    .get();

  if (!wh) {
    return c.json({ error: "Webhook not found", code: "NOT_FOUND" }, 404);
  }

  db.delete(webhooks).where(eq(webhooks.id, id)).run();
  return c.json({ ok: true });
});

export default notifRouter;
