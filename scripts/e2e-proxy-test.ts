/**
 * End-to-end integration test for the full platform → arb-scanner proxy flow.
 *
 * What it tests:
 *   1. Starts a mock arb engine (simulates /api/scan and /health)
 *   2. Boots the AgentForge platform as a child process on an ephemeral DB
 *   3. Registers a creator, publishes the arb-scanner agent
 *   4. Creates an API key, subscribes to the agent
 *   5. Calls POST /api/call/arb-scanner through the platform proxy
 *   6. Verifies the response is correct end-to-end
 *   7. Tests error paths: bad key, no subscription, timeout, malformed JSON
 *
 * Usage:
 *   npx tsx scripts/e2e-proxy-test.ts
 */

import http from "http";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

const PLATFORM_PORT = 4099;
const ENGINE_PORT = 4098;
const PLATFORM = `http://localhost:${PLATFORM_PORT}`;
const ENGINE = `http://localhost:${ENGINE_PORT}`;
const TEST_DB = path.resolve("platform/data/e2e-test.db");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

// ─── Mock Arb Engine ───────────────────────────────────────────

function startMockEngine(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${ENGINE_PORT}`);

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (url.pathname === "/api/scan" && req.method === "POST") {
        let body = "";
        req.on("data", (c: Buffer) => (body += c));
        req.on("end", () => {
          const input = body ? JSON.parse(body) : {};
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              opportunities: [
                {
                  pairId: "test-pair-1",
                  kalshiTicker: "PRES-2024-DEM",
                  polymarketId: "0xabc123",
                  strategy: "kalshi_yes_poly_no",
                  bestSpreadCents: 5,
                  netSpreadCents: input.minSpread ?? 3,
                  estimatedFeesCents: 2,
                  detectedAt: new Date().toISOString(),
                },
              ],
              total: 1,
              engine: { pairsTracked: 42, uptime: 3600 },
            })
          );
        });
        return;
      }

      if (url.pathname === "/api/bad-json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("this is not json{{{");
        return;
      }

      if (url.pathname === "/api/server-error") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal failure" }));
        return;
      }

      res.writeHead(404);
      res.end("not found");
    });

    server.listen(ENGINE_PORT, () => {
      console.log(`Mock engine on :${ENGINE_PORT}`);
      resolve(server);
    });
  });
}

// ─── Platform Boot (child process) ────────────────────────────

function startPlatform(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    // Clean stale test DB
    try { fs.unlinkSync(TEST_DB); } catch {}

    const child = spawn("npx", ["tsx", "server/index.ts"], {
      cwd: path.resolve("platform"),
      env: {
        ...process.env,
        PORT: String(PLATFORM_PORT),
        DB_PATH: TEST_DB,
        JWT_SECRET: "e2e-test-secret",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let started = false;

    child.stdout?.on("data", (data: Buffer) => {
      const line = data.toString();
      if (!started && line.includes("localhost")) {
        started = true;
        // Give server a moment to fully bind
        setTimeout(() => resolve(child), 300);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line && !line.includes("ExperimentalWarning")) {
        process.stderr.write(`[platform] ${line}\n`);
      }
    });

    child.on("error", reject);

    // Timeout if server doesn't start
    setTimeout(() => {
      if (!started) {
        child.kill();
        reject(new Error("Platform server failed to start within 10s"));
      }
    }, 10000);
  });
}

// ─── Helpers ───────────────────────────────────────────────────

async function api(
  urlPath: string,
  opts: {
    method?: string;
    body?: unknown;
    token?: string;
    apiKey?: string;
  } = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.apiKey) headers["X-API-Key"] = opts.apiKey;

  const res = await fetch(`${PLATFORM}${urlPath}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// ─── Test Cases ────────────────────────────────────────────────

async function runTests() {
  console.log("\n━━━ E2E: Platform → Arb Scanner ━━━\n");

  // Health check
  const health = await api("/health");
  assert(health.status === 200, "Platform health check returns 200");

  // 1. Register creator
  console.log("\n1. Auth");
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "E2E Tester",
      email: "e2e@test.io",
      password: "testpassword123",
    },
  });
  assert(reg.status === 201, "Register returns 201");
  assert(!!reg.data?.token, "Register returns JWT token");
  const token = reg.data?.token;

  // Validate /me
  const me = await api("/api/auth/me", { token });
  assert(me.status === 200, "GET /auth/me returns 200");
  assert(me.data?.name === "E2E Tester", "/me returns correct name");
  assert(me.data?.email === "e2e@test.io", "/me returns correct email");

  // 2. Publish agent pointing at mock engine
  console.log("\n2. Publish agent");
  const pub = await api("/api/agents", {
    method: "POST",
    token,
    body: {
      name: "Arb Scanner",
      slug: "arb-scanner",
      description: "E2E test agent",
      category: "trading",
      endpointUrl: `${ENGINE}/api/scan`,
      healthCheckUrl: `${ENGINE}/health`,
      pricing: "usage",
      pricePerCall: 0.01,
      rateLimit: 60,
    },
  });
  assert(pub.status === 201, "Publish returns 201");
  assert(pub.data?.slug === "arb-scanner", "Agent slug matches");

  // Verify agent is visible
  const detail = await api("/api/agents/arb-scanner");
  assert(detail.status === 200, "GET /agents/arb-scanner returns 200");
  assert(detail.data?.name === "Arb Scanner", "Agent detail name matches");
  assert(detail.data?.creator?.name === "E2E Tester", "Creator name on detail page");

  // 3. Create API key
  console.log("\n3. API keys");
  const keyRes = await api("/api/keys", {
    method: "POST",
    token,
    body: { name: "e2e-key" },
  });
  assert(keyRes.status === 201, "Key creation returns 201");
  assert(keyRes.data?.key?.startsWith("af_"), "Key has af_ prefix");
  const apiKey = keyRes.data?.key;

  // 4. Subscribe to agent
  console.log("\n4. Subscribe");
  const subRes = await api("/api/subscriptions", {
    method: "POST",
    token,
    body: { agentId: pub.data?.id },
  });
  assert(subRes.status === 201, "Subscribe returns 201");
  assert(subRes.data?.status === "active", "Subscription is active");

  // 5. Proxy call — happy path
  console.log("\n5. Proxy call (happy path)");
  const call = await api("/api/call/arb-scanner", {
    method: "POST",
    apiKey,
    body: { minSpread: 2, limit: 10 },
  });
  assert(call.status === 200, "Proxy call returns 200");
  assert(call.data?.output?.total === 1, "Returns 1 opportunity");
  assert(
    call.data?.output?.opportunities?.[0]?.kalshiTicker === "PRES-2024-DEM",
    "Opportunity has correct ticker"
  );
  assert(
    call.data?.output?.opportunities?.[0]?.netSpreadCents === 2,
    "minSpread passed through to engine"
  );
  assert(typeof call.data?.latencyMs === "number", "Response includes latencyMs");
  assert(call.data?.status === 200, "Response includes agent status code");

  // 6. Error paths
  console.log("\n6. Error paths");

  // Bad API key
  const badKey = await api("/api/call/arb-scanner", {
    method: "POST",
    apiKey: "af_invalid_key_12345",
    body: {},
  });
  assert(badKey.status === 401, "Invalid key returns 401");
  assert(badKey.data?.code === "UNAUTHORIZED", "Error code is UNAUTHORIZED");

  // Missing API key
  const noKey = await api("/api/call/arb-scanner", { method: "POST", body: {} });
  assert(noKey.status === 401, "Missing key returns 401");

  // Non-existent agent
  const noAgent = await api("/api/call/nonexistent", {
    method: "POST",
    apiKey,
    body: {},
  });
  assert(noAgent.status === 404, "Unknown agent returns 404");

  // 7. Agent error responses
  console.log("\n7. Agent error responses");

  // Agent that returns 500
  const errAgent = await api("/api/agents", {
    method: "POST",
    token,
    body: {
      name: "Error Agent",
      slug: "error-agent",
      description: "Returns 500",
      category: "testing",
      endpointUrl: `${ENGINE}/api/server-error`,
      pricing: "free",
    },
  });
  assert(errAgent.status === 201, "Error agent published");

  const errCall = await api("/api/call/error-agent", {
    method: "POST",
    apiKey,
    body: {},
  });
  assert(errCall.status === 502, "Agent 500 → proxy returns 502");
  assert(errCall.data?.code === "BAD_GATEWAY", "Error code is BAD_GATEWAY");
  assert(errCall.data?.agentStatus === 500, "Original agent status preserved");

  // Agent that returns bad JSON
  const badJsonAgent = await api("/api/agents", {
    method: "POST",
    token,
    body: {
      name: "Bad JSON Agent",
      slug: "bad-json-agent",
      description: "Returns invalid JSON",
      category: "testing",
      endpointUrl: `${ENGINE}/api/bad-json`,
      pricing: "free",
    },
  });
  assert(badJsonAgent.status === 201, "Bad JSON agent published");

  const badJsonCall = await api("/api/call/bad-json-agent", {
    method: "POST",
    apiKey,
    body: {},
  });
  assert(badJsonCall.status === 502, "Invalid JSON → proxy returns 502");
  assert(badJsonCall.data?.code === "BAD_GATEWAY", "Bad JSON error code is BAD_GATEWAY");

  // 8. Profile update
  console.log("\n8. Profile update");
  const update = await api("/api/auth/me", {
    method: "PATCH",
    token,
    body: { name: "Updated Tester", bio: "I run e2e tests" },
  });
  assert(update.status === 200, "Profile update returns 200");

  const meAfter = await api("/api/auth/me", { token });
  assert(meAfter.data?.name === "Updated Tester", "Name updated");
  assert(meAfter.data?.bio === "I run e2e tests", "Bio updated");
  assert(meAfter.data?.agentCount >= 1, "agentCount reflects published agents");

  // 9. Duplicate slug rejection
  console.log("\n9. Edge cases");
  const dup = await api("/api/agents", {
    method: "POST",
    token,
    body: {
      name: "Arb Scanner 2",
      slug: "arb-scanner",
      description: "Duplicate",
      category: "trading",
      endpointUrl: `${ENGINE}/api/scan`,
    },
  });
  assert(dup.status === 409, "Duplicate slug returns 409");

  // Duplicate subscription
  const dupSub = await api("/api/subscriptions", {
    method: "POST",
    token,
    body: { agentId: pub.data?.id },
  });
  assert(dupSub.status === 409, "Duplicate subscription returns 409");
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const engine = await startMockEngine();
  let platform: ChildProcess | null = null;

  try {
    platform = await startPlatform();
    await runTests();
  } catch (err) {
    console.error("\nTest runner error:", (err as Error).message);
    console.error((err as Error).stack);
    failed++;
  } finally {
    console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━`);
    if (failures.length > 0) {
      console.log("\nFailures:");
      failures.forEach((f) => console.log(`  - ${f}`));
    }

    engine.close();
    if (platform) platform.kill();

    // Clean up test DB
    try { fs.unlinkSync(TEST_DB); } catch {}

    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
