import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";

import "./db/index.js"; // init database
import authRoutes from "./routes/auth.js";
import agentsRoutes from "./routes/agents.js";
import subsRoutes from "./routes/subscriptions.js";
import keysRoutes from "./routes/keys.js";
import proxyRoutes from "./routes/proxy.js";
import notifRoutes from "./routes/notifications.js";
import billingRoutes from "./routes/billing.js";
import { startHealthChecker } from "./health-checker.js";

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// API routes
app.route("/api/auth", authRoutes);
app.route("/api/agents", agentsRoutes);
app.route("/api/subscriptions", subsRoutes);
app.route("/api/keys", keysRoutes);
app.route("/api/call", proxyRoutes);
app.route("/api/notifications", notifRoutes);
app.route("/api/billing", billingRoutes);

// Stats endpoint
app.get("/api/stats", async (c) => {
  const { db } = await import("./db/index.js");
  const { sql } = await import("drizzle-orm");
  const { agents, creators, subscriptions } = await import(
    "../shared/schema.js"
  );

  const agentCount = db
    .select({ count: sql<number>`count(*)` })
    .from(agents)
    .get();
  const creatorCount = db
    .select({ count: sql<number>`count(*)` })
    .from(creators)
    .get();
  const subCount = db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .get();

  return c.json({
    agents: agentCount?.count || 0,
    creators: creatorCount?.count || 0,
    subscriptions: subCount?.count || 0,
  });
});

// Start server
const port = parseInt(process.env.PORT || "4000");

serve({ fetch: app.fetch, port }, () => {
  console.log(`
  ┌─────────────────────────────────────┐
  │  AgentForge Platform v0.1.0         │
  │  http://localhost:${port}              │
  │                                     │
  │  Routes:                            │
  │    POST /api/auth/register          │
  │    POST /api/auth/login             │
  │    GET  /api/auth/me                │
  │    GET  /api/agents                 │
  │    GET  /api/agents/mine            │
  │    GET  /api/agents/mine/:slug/usage│
  │    GET  /api/agents/:slug           │
  │    POST /api/agents                 │
  │  PATCH  /api/agents/:slug           │
  │  PATCH  /api/agents/:slug/status    │
  │ DELETE  /api/agents/:slug           │
  │    GET  /api/subscriptions          │
  │    POST /api/subscriptions          │
  │    GET  /api/keys                   │
  │    POST /api/keys                   │
  │    POST /api/call/:slug             │
  │    GET  /api/stats                  │
  └─────────────────────────────────────┘
  `);

  // Start periodic health checking
  startHealthChecker();
});

export default app;
