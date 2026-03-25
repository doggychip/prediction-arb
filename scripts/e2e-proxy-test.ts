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

  // 9. My Agents
  console.log("\n9. My Agents");
  const mine = await api("/api/agents/mine", { token });
  assert(mine.status === 200, "GET /agents/mine returns 200");
  assert(mine.data?.agents?.length >= 1, "My agents list includes arb-scanner");
  const myAgent = mine.data?.agents?.find((a: any) => a.slug === "arb-scanner");
  assert(!!myAgent, "arb-scanner found in my agents");
  assert(typeof myAgent?.totalCalls === "number", "My agent includes totalCalls");
  assert(typeof myAgent?.subscriberCount === "number", "My agent includes subscriberCount");

  // 10. Usage stats
  console.log("\n10. Usage stats");
  const usageRes = await api("/api/agents/mine/arb-scanner/usage", { token });
  assert(usageRes.status === 200, "GET /agents/mine/arb-scanner/usage returns 200");
  assert(usageRes.data?.totalCalls >= 1, "Usage shows at least 1 call");
  assert(typeof usageRes.data?.avgLatencyMs === "number", "Usage includes avgLatencyMs");
  assert(typeof usageRes.data?.errorRate === "number", "Usage includes errorRate");
  assert(typeof usageRes.data?.estimatedRevenue === "number", "Usage includes estimatedRevenue");
  assert(Array.isArray(usageRes.data?.daily), "Usage includes daily breakdown");

  // Non-owner can't see usage
  const reg2 = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Other User", email: "other@test.io", password: "testpassword123" },
  });
  const otherToken = reg2.data?.token;
  const otherUsage = await api("/api/agents/mine/arb-scanner/usage", { token: otherToken });
  assert(otherUsage.status === 404, "Non-owner can't see usage stats");

  // 11. Agent status management
  console.log("\n11. Agent status management");

  // Suspend
  const suspend = await api("/api/agents/arb-scanner/status", {
    method: "PATCH",
    token,
    body: { status: "suspended" },
  });
  assert(suspend.status === 200, "Suspend returns 200");
  assert(suspend.data?.status === "suspended", "Status is suspended");

  // Suspended agent not visible in public list
  const listAfterSuspend = await api("/api/agents");
  const foundSuspended = listAfterSuspend.data?.agents?.find((a: any) => a.slug === "arb-scanner");
  assert(!foundSuspended, "Suspended agent hidden from public list");

  // Suspended agent can't be called
  const callSuspended = await api("/api/call/arb-scanner", {
    method: "POST",
    apiKey,
    body: {},
  });
  assert(callSuspended.status === 404, "Suspended agent returns 404 on call");

  // Re-activate
  const reactivate = await api("/api/agents/arb-scanner/status", {
    method: "PATCH",
    token,
    body: { status: "active" },
  });
  assert(reactivate.status === 200, "Reactivate returns 200");

  // Non-owner can't change status
  const otherSuspend = await api("/api/agents/arb-scanner/status", {
    method: "PATCH",
    token: otherToken,
    body: { status: "suspended" },
  });
  assert(otherSuspend.status === 403, "Non-owner can't change agent status");

  // 12. Agent deletion
  console.log("\n12. Agent deletion");

  // Create a throwaway agent to delete
  const throwaway = await api("/api/agents", {
    method: "POST",
    token,
    body: {
      name: "Throwaway Agent",
      slug: "throwaway",
      description: "Will be deleted",
      category: "testing",
      endpointUrl: `${ENGINE}/api/scan`,
      pricing: "free",
    },
  });
  assert(throwaway.status === 201, "Throwaway agent created");

  // Non-owner can't delete
  const otherDelete = await api("/api/agents/throwaway", {
    method: "DELETE",
    token: otherToken,
  });
  assert(otherDelete.status === 403, "Non-owner can't delete agent");

  // Owner deletes
  const del = await api("/api/agents/throwaway", {
    method: "DELETE",
    token,
  });
  assert(del.status === 200, "Delete returns 200");

  // Verify deleted
  const afterDel = await api("/api/agents/throwaway");
  assert(afterDel.status === 404, "Deleted agent returns 404");

  // 13. Reviews
  console.log("\n13. Reviews");

  // Other user subscribes to arb-scanner first (required for usage-priced agents)
  await api("/api/subscriptions", {
    method: "POST",
    token: otherToken,
    body: { agentId: pub.data?.id },
  });

  // Other user reviews arb-scanner
  const review1 = await api("/api/agents/arb-scanner/reviews", {
    method: "POST",
    token: otherToken,
    body: { rating: 4, comment: "Great agent for arb scanning!" },
  });
  assert(review1.status === 201, "Review submission returns 201");
  assert(review1.data?.rating === 4, "Review rating is 4");
  assert(review1.data?.comment === "Great agent for arb scanning!", "Review comment matches");
  assert(!!review1.data?.userName, "Review includes userName");

  // Duplicate review rejected
  const dupReview = await api("/api/agents/arb-scanner/reviews", {
    method: "POST",
    token: otherToken,
    body: { rating: 5 },
  });
  assert(dupReview.status === 409, "Duplicate review returns 409");

  // Owner can't review own agent
  const selfReview = await api("/api/agents/arb-scanner/reviews", {
    method: "POST",
    token,
    body: { rating: 5, comment: "My own agent is great" },
  });
  assert(selfReview.status === 403, "Owner can't review own agent");

  // Invalid rating rejected
  const badRating = await api("/api/agents/arb-scanner/reviews", {
    method: "POST",
    token: otherToken,
    body: { rating: 6 },
  });
  // Already reviewed so 409, but let's test bad rating with a fresh agent
  const reviewBadRating = await api("/api/agents/error-agent/reviews", {
    method: "POST",
    token: otherToken,
    body: { rating: 0 },
  });
  assert(reviewBadRating.status === 400, "Rating 0 returns 400");

  const reviewBadRating2 = await api("/api/agents/error-agent/reviews", {
    method: "POST",
    token: otherToken,
    body: { rating: 6 },
  });
  assert(reviewBadRating2.status === 400, "Rating 6 returns 400");

  // Review appears on agent detail
  const detailWithReview = await api("/api/agents/arb-scanner");
  assert(detailWithReview.data?.reviews?.length >= 1, "Agent detail includes the review");
  assert(detailWithReview.data?.reviews?.[0]?.rating === 4, "Review rating visible on detail");

  // Unauthenticated review rejected
  const noAuthReview = await api("/api/agents/arb-scanner/reviews", {
    method: "POST",
    body: { rating: 3 },
  });
  assert(noAuthReview.status === 401, "Unauthenticated review returns 401");

  // 14. Agent editing
  console.log("\n14. Agent editing");

  const editRes = await api("/api/agents/arb-scanner", {
    method: "PATCH",
    token,
    body: {
      name: "Arb Scanner Pro",
      description: "Updated description",
      category: "analysis",
      tags: ["arb", "prediction-markets"],
      rateLimit: 200,
    },
  });
  assert(editRes.status === 200, "Agent edit returns 200");

  // Verify changes
  const detailAfterEdit = await api("/api/agents/arb-scanner");
  assert(detailAfterEdit.data?.name === "Arb Scanner Pro", "Name updated");
  assert(detailAfterEdit.data?.description === "Updated description", "Description updated");
  assert(detailAfterEdit.data?.category === "analysis", "Category updated");
  assert(detailAfterEdit.data?.rateLimit === 200, "Rate limit updated");
  assert(detailAfterEdit.data?.tags?.includes("arb"), "Tags updated");

  // Non-owner can't edit
  const otherEdit = await api("/api/agents/arb-scanner", {
    method: "PATCH",
    token: otherToken,
    body: { name: "Hacked Name" },
  });
  assert(otherEdit.status === 403, "Non-owner can't edit agent");

  // 15. Rate limiting
  console.log("\n15. Rate limiting");

  // Create an agent with very low rate limit to test
  const rateLimitedAgent = await api("/api/agents", {
    method: "POST",
    token,
    body: {
      name: "Rate Limited Agent",
      slug: "rate-limited",
      description: "Low rate limit for testing",
      category: "testing",
      endpointUrl: `${ENGINE}/api/scan`,
      pricing: "free",
      rateLimit: 2,
    },
  });
  assert(rateLimitedAgent.status === 201, "Rate limited agent created");

  // Make 2 calls (within limit)
  const rlCall1 = await api("/api/call/rate-limited", { method: "POST", apiKey, body: {} });
  assert(rlCall1.status === 200, "First call within rate limit succeeds");
  const rlCall2 = await api("/api/call/rate-limited", { method: "POST", apiKey, body: {} });
  assert(rlCall2.status === 200, "Second call within rate limit succeeds");

  // Third call should be rate limited
  const rlCall3 = await api("/api/call/rate-limited", { method: "POST", apiKey, body: {} });
  assert(rlCall3.status === 429, "Third call exceeds rate limit → 429");
  assert(rlCall3.data?.code === "RATE_LIMITED", "Error code is RATE_LIMITED");

  // 16. Password change
  console.log("\n16. Password change");

  const pwChange = await api("/api/auth/change-password", {
    method: "POST",
    token,
    body: { currentPassword: "testpassword123", newPassword: "newpassword456" },
  });
  assert(pwChange.status === 200, "Password change returns 200");

  // Login with new password
  const loginNew = await api("/api/auth/login", {
    method: "POST",
    body: { email: "e2e@test.io", password: "newpassword456" },
  });
  assert(loginNew.status === 200, "Login with new password works");

  // Old password fails
  const loginOld = await api("/api/auth/login", {
    method: "POST",
    body: { email: "e2e@test.io", password: "testpassword123" },
  });
  assert(loginOld.status === 401, "Old password rejected");

  // Wrong current password fails
  const pwBad = await api("/api/auth/change-password", {
    method: "POST",
    token,
    body: { currentPassword: "wrongpassword", newPassword: "something123" },
  });
  assert(pwBad.status === 401, "Wrong current password returns 401");

  // Short new password fails
  const pwShort = await api("/api/auth/change-password", {
    method: "POST",
    token,
    body: { currentPassword: "newpassword456", newPassword: "short" },
  });
  assert(pwShort.status === 400, "Short new password returns 400");

  // 17. Email verification
  console.log("\n17. Email verification");

  const sendVerify = await api("/api/auth/verify-email/send", {
    method: "POST",
    token,
  });
  assert(sendVerify.status === 201, "Send verification returns 201");
  assert(!!sendVerify.data?.token, "Dev mode returns token directly");

  // Confirm with token
  const confirmVerify = await api("/api/auth/verify-email/confirm", {
    method: "POST",
    body: { token: sendVerify.data?.token },
  });
  assert(confirmVerify.status === 200, "Email verification confirm returns 200");

  // Check profile shows verified
  const meAfterVerify = await api("/api/auth/me", { token });
  assert(meAfterVerify.data?.emailVerified === true, "Profile shows email verified");

  // Already verified
  const sendAgain = await api("/api/auth/verify-email/send", {
    method: "POST",
    token,
  });
  assert(sendAgain.status === 409, "Already verified returns 409");

  // Invalid token
  const badConfirm = await api("/api/auth/verify-email/confirm", {
    method: "POST",
    body: { token: "invalid-token" },
  });
  assert(badConfirm.status === 404, "Invalid token returns 404");

  // 18. Notifications
  console.log("\n18. Notifications");

  // Creator should have notifications from subscription + review
  const notifs = await api("/api/notifications", { token });
  assert(notifs.status === 200, "GET notifications returns 200");
  assert(notifs.data?.notifications?.length >= 1, "Has at least 1 notification");
  assert(typeof notifs.data?.unreadCount === "number", "Has unreadCount");

  // Mark one as read
  const firstNotif = notifs.data?.notifications?.[0];
  if (firstNotif) {
    const markRead = await api(`/api/notifications/${firstNotif.id}/read`, {
      method: "PATCH",
      token,
    });
    assert(markRead.status === 200, "Mark notification read returns 200");
  }

  // Mark all as read
  const markAll = await api("/api/notifications/read-all", {
    method: "POST",
    token,
  });
  assert(markAll.status === 200, "Mark all read returns 200");

  // Verify unread count is 0
  const notifsAfter = await api("/api/notifications", { token });
  assert(notifsAfter.data?.unreadCount === 0, "Unread count is 0 after mark-all");

  // 19. Webhooks
  console.log("\n19. Webhooks");

  const createWh = await api("/api/notifications/webhooks", {
    method: "POST",
    token,
    body: { url: `${ENGINE}/webhook`, events: ["subscription.created", "review.created"] },
  });
  assert(createWh.status === 201, "Create webhook returns 201");
  assert(!!createWh.data?.id, "Webhook has id");
  assert(!!createWh.data?.secret, "Webhook returns secret");

  const listWh = await api("/api/notifications/webhooks", { token });
  assert(listWh.status === 200, "List webhooks returns 200");
  assert(listWh.data?.webhooks?.length === 1, "Has 1 webhook");

  // Invalid events
  const badWh = await api("/api/notifications/webhooks", {
    method: "POST",
    token,
    body: { url: `${ENGINE}/webhook`, events: ["invalid.event"] },
  });
  assert(badWh.status === 400, "Invalid webhook events returns 400");

  // Delete webhook
  const delWh = await api(`/api/notifications/webhooks/${createWh.data?.id}`, {
    method: "DELETE",
    token,
  });
  assert(delWh.status === 200, "Delete webhook returns 200");

  // 20. Billing
  console.log("\n20. Billing");

  const billing = await api("/api/billing", { token });
  assert(billing.status === 200, "GET billing returns 200");
  assert(billing.data?.account?.plan === "free", "Default plan is free");
  assert(Array.isArray(billing.data?.payments), "Has payments array");

  // Upgrade to pro
  const upgrade = await api("/api/billing/upgrade", {
    method: "POST",
    token,
    body: { plan: "pro" },
  });
  assert(upgrade.status === 200, "Upgrade returns 200");
  assert(upgrade.data?.plan === "pro", "Plan is now pro");

  // Verify billing shows pro
  const billingAfter = await api("/api/billing", { token });
  assert(billingAfter.data?.account?.plan === "pro", "Account shows pro plan");
  assert(billingAfter.data?.payments?.length >= 1, "Has payment record");

  // Revenue endpoint
  const revenue = await api("/api/billing/revenue", { token });
  assert(revenue.status === 200, "Revenue returns 200");
  assert(Array.isArray(revenue.data?.agents), "Revenue includes agents");
  assert(typeof revenue.data?.totalEstimatedMonthly === "number", "Revenue includes total");

  // Invalid plan
  const badPlan = await api("/api/billing/upgrade", {
    method: "POST",
    token,
    body: { plan: "invalid" },
  });
  assert(badPlan.status === 400, "Invalid plan returns 400");

  // Connect (mock)
  const connect = await api("/api/billing/connect", {
    method: "POST",
    token,
  });
  assert(connect.status === 200, "Connect returns 200");
  assert(connect.data?.connected === true, "Shows connected");

  // 21. Pagination
  console.log("\n21. Pagination");

  const page1 = await api("/api/agents?limit=1&offset=0");
  assert(page1.status === 200, "Paginated list returns 200");
  assert(page1.data?.agents?.length <= 1, "Respects limit=1");
  assert(typeof page1.data?.total === "number", "Returns total count");
  assert(typeof page1.data?.limit === "number", "Returns limit");
  assert(typeof page1.data?.offset === "number", "Returns offset");

  // 22. Duplicate slug & subscription rejection
  console.log("\n22. Edge cases");
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
