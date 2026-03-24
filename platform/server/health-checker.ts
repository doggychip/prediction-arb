/**
 * Periodic health checker — pings each agent's healthCheckUrl
 * and updates agents.health_status + agents.health_checked_at.
 */

import { eq, and, isNotNull, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { agents } from "../shared/schema.js";

const HEALTH_CHECK_INTERVAL_MS = 60_000; // every 60s
const HEALTH_CHECK_TIMEOUT_MS = 10_000; // 10s per check

async function checkAgent(agentId: string, url: string): Promise<"healthy" | "unhealthy"> {
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return res.ok ? "healthy" : "unhealthy";
  } catch {
    return "unhealthy";
  }
}

async function runHealthChecks() {
  const activeAgents = db
    .select({ id: agents.id, healthCheckUrl: agents.healthCheckUrl })
    .from(agents)
    .where(
      and(
        eq(agents.status, "active"),
        isNotNull(agents.healthCheckUrl)
      )
    )
    .all();

  for (const agent of activeAgents) {
    if (!agent.healthCheckUrl) continue;

    const status = await checkAgent(agent.id, agent.healthCheckUrl);

    db.update(agents)
      .set({
        healthStatus: status,
        healthCheckedAt: sql`datetime('now')`,
      })
      .where(eq(agents.id, agent.id))
      .run();
  }
}

export function startHealthChecker() {
  // Run immediately on startup, then periodically
  runHealthChecks().catch(() => {});
  setInterval(() => {
    runHealthChecks().catch(() => {});
  }, HEALTH_CHECK_INTERVAL_MS);
}
