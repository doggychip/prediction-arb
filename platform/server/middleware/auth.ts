import { Context, Next } from "hono";
import { jwtVerify, SignJWT } from "jose";
import { nanoid } from "nanoid";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-change-in-production"
);

const TOKEN_EXPIRY = "7d";

export async function createToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, jti: nanoid() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyToken(
  token: string
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

// Middleware: require JWT auth
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization", code: "UNAUTHORIZED" }, 401);
  }

  const token = header.slice(7);
  const result = await verifyToken(token);
  if (!result) {
    return c.json({ error: "Invalid token", code: "UNAUTHORIZED" }, 401);
  }

  c.set("userId", result.userId);
  await next();
}

// Middleware: authenticate via API key
export async function requireApiKey(c: Context, next: Next) {
  const key = c.req.header("X-API-Key");
  if (!key) {
    return c.json({ error: "Missing API key", code: "UNAUTHORIZED" }, 401);
  }

  // Store raw key for lookup in route handler
  c.set("rawApiKey", key);
  await next();
}
