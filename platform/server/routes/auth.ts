import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hash, verify } from "argon2";
import { db } from "../db/index.js";
import { creators } from "../../shared/schema.js";
import { createToken } from "../middleware/auth.js";
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

export default auth;
