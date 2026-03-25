import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hash, verify } from "argon2";
import { db } from "../db/index.js";
import { creators, agents, emailVerifications } from "../../shared/schema.js";
import { createToken, requireAuth } from "../middleware/auth.js";
import type { RegisterRequest, LoginRequest } from "../../shared/types.js";

const auth = new Hono();

// POST /auth/register
auth.post("/register", async (c) => {
  const body = await c.req.json<RegisterRequest>();

  if (!body.name || !body.email || !body.password) {
    return c.json({ error: "Missing required fields", code: "VALIDATION" }, 400);
  }

  if (body.password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters", code: "VALIDATION" }, 400);
  }

  // Check if email already exists
  const existing = db
    .select()
    .from(creators)
    .where(eq(creators.email, body.email))
    .get();

  if (existing) {
    return c.json({ error: "Email already registered", code: "CONFLICT" }, 409);
  }

  const id = nanoid();
  const passwordHash = await hash(body.password);

  db.insert(creators)
    .values({
      id,
      name: body.name,
      email: body.email,
      passwordHash,
      bio: body.bio,
    })
    .run();

  const token = await createToken(id);

  return c.json({
    token,
    user: { id, name: body.name, email: body.email },
  }, 201);
});

// POST /auth/login
auth.post("/login", async (c) => {
  const body = await c.req.json<LoginRequest>();

  if (!body.email || !body.password) {
    return c.json({ error: "Missing credentials", code: "VALIDATION" }, 400);
  }

  const user = db
    .select()
    .from(creators)
    .where(eq(creators.email, body.email))
    .get();

  if (!user) {
    return c.json({ error: "Invalid credentials", code: "UNAUTHORIZED" }, 401);
  }

  const valid = await verify(user.passwordHash, body.password);
  if (!valid) {
    return c.json({ error: "Invalid credentials", code: "UNAUTHORIZED" }, 401);
  }

  const token = await createToken(user.id);

  return c.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
  });
});

// GET /auth/me — validate token and return current user profile
auth.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId");

  const user = db
    .select({
      id: creators.id,
      name: creators.name,
      email: creators.email,
      bio: creators.bio,
      avatarUrl: creators.avatarUrl,
      verified: creators.verified,
      emailVerified: creators.emailVerified,
      createdAt: creators.createdAt,
    })
    .from(creators)
    .where(eq(creators.id, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found", code: "NOT_FOUND" }, 404);
  }

  // Count published agents
  const agentCount = db
    .select({ count: sql<number>`count(*)` })
    .from(agents)
    .where(eq(agents.creatorId, userId))
    .get();

  return c.json({
    ...user,
    agentCount: agentCount?.count || 0,
  });
});

// PATCH /auth/me — update profile
auth.patch("/me", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name?: string; bio?: string; avatarUrl?: string }>();

  const updates: Record<string, unknown> = {};
  if (body.name) updates.name = body.name;
  if (body.bio !== undefined) updates.bio = body.bio;
  if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update", code: "VALIDATION" }, 400);
  }

  db.update(creators)
    .set(updates)
    .where(eq(creators.id, userId))
    .run();

  return c.json({ ok: true });
});

// POST /auth/change-password
auth.post("/change-password", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ currentPassword: string; newPassword: string }>();

  if (!body.currentPassword || !body.newPassword) {
    return c.json({ error: "Both currentPassword and newPassword required", code: "VALIDATION" }, 400);
  }

  if (body.newPassword.length < 8) {
    return c.json({ error: "New password must be at least 8 characters", code: "VALIDATION" }, 400);
  }

  const user = db.select().from(creators).where(eq(creators.id, userId)).get();
  if (!user) {
    return c.json({ error: "User not found", code: "NOT_FOUND" }, 404);
  }

  const valid = await verify(user.passwordHash, body.currentPassword);
  if (!valid) {
    return c.json({ error: "Current password is incorrect", code: "UNAUTHORIZED" }, 401);
  }

  const newHash = await hash(body.newPassword);
  db.update(creators)
    .set({ passwordHash: newHash })
    .where(eq(creators.id, userId))
    .run();

  return c.json({ ok: true });
});

// POST /auth/verify-email/send — send verification token
auth.post("/verify-email/send", requireAuth, async (c) => {
  const userId = c.get("userId");

  const user = db
    .select({ email: creators.email, emailVerified: creators.emailVerified })
    .from(creators)
    .where(eq(creators.id, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found", code: "NOT_FOUND" }, 404);
  }

  if (user.emailVerified) {
    return c.json({ error: "Email already verified", code: "CONFLICT" }, 409);
  }

  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  db.insert(emailVerifications)
    .values({ id: nanoid(), userId, token, expiresAt })
    .run();

  // In production: send email with verification link
  // For now, return token directly (dev mode)
  const emailEnabled = !!process.env.SMTP_HOST;

  return c.json({
    ok: true,
    message: emailEnabled
      ? "Verification email sent"
      : "Email sending not configured — use token directly",
    ...(emailEnabled ? {} : { token }),
  }, 201);
});

// POST /auth/verify-email/confirm — confirm email with token
auth.post("/verify-email/confirm", async (c) => {
  const { token } = await c.req.json<{ token: string }>();

  if (!token) {
    return c.json({ error: "Token required", code: "VALIDATION" }, 400);
  }

  const record = db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.token, token))
    .get();

  if (!record) {
    return c.json({ error: "Invalid token", code: "NOT_FOUND" }, 404);
  }

  if (new Date(record.expiresAt) < new Date()) {
    return c.json({ error: "Token expired", code: "EXPIRED" }, 410);
  }

  db.update(creators)
    .set({ emailVerified: true })
    .where(eq(creators.id, record.userId))
    .run();

  // Clean up used token
  db.delete(emailVerifications)
    .where(eq(emailVerifications.id, record.id))
    .run();

  return c.json({ ok: true, message: "Email verified" });
});

export default auth;
