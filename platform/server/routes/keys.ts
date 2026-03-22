import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createHash } from "crypto";
import { db } from "../db/index.js";
import { apiKeys } from "../../shared/schema.js";
import { requireAuth } from "../middleware/auth.js";

const keysRouter = new Hono();

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// GET /keys — list my API keys (masked)
keysRouter.get("/", requireAuth, async (c) => {
  const userId = c.get("userId");

  const keys = db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .all();

  return c.json({ keys });
});

// POST /keys — create a new API key
keysRouter.post("/", requireAuth, async (c) => {
  const userId = c.get("userId");
  const { name, scopes } = await c.req.json<{
    name: string;
    scopes?: string;
  }>();

  if (!name) {
    return c.json({ error: "name required", code: "VALIDATION" }, 400);
  }

  const id = nanoid();
  const rawKey = `af_${nanoid(32)}`;
  const prefix = rawKey.slice(0, 11);

  db.insert(apiKeys)
    .values({
      id,
      userId,
      name,
      keyHash: hashKey(rawKey),
      prefix,
      scopes: scopes || "read",
    })
    .run();

  // Return the raw key only once — it's never stored
  return c.json({ id, key: rawKey, prefix, name }, 201);
});

// DELETE /keys/:id — revoke an API key
keysRouter.delete("/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const key = db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .get();

  if (!key || key.userId !== userId) {
    return c.json({ error: "Key not found", code: "NOT_FOUND" }, 404);
  }

  db.delete(apiKeys).where(eq(apiKeys.id, id)).run();

  return c.json({ ok: true });
});

export { hashKey };
export default keysRouter;
