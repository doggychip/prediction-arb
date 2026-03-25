/**
 * Billing routes — Stripe integration stub.
 * Real Stripe calls are gated behind STRIPE_SECRET_KEY env var.
 * Without it, endpoints return mock responses for development.
 */

import { Hono } from "hono";
import { eq, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { billingAccounts, payments, agents, subscriptions } from "../../shared/schema.js";
import { requireAuth } from "../middleware/auth.js";

const billingRouter = new Hono();

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

function stripeEnabled(): boolean {
  return !!STRIPE_KEY;
}

// GET /billing — get billing account + payment history
billingRouter.get("/", requireAuth, async (c) => {
  const userId = c.get("userId");

  let account = db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.userId, userId))
    .get();

  if (!account) {
    // Auto-create free billing account
    const id = nanoid();
    db.insert(billingAccounts)
      .values({ id, userId, plan: "free" })
      .run();
    account = db.select().from(billingAccounts).where(eq(billingAccounts.id, id)).get()!;
  }

  const recentPayments = db
    .select()
    .from(payments)
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt))
    .limit(20)
    .all();

  return c.json({
    account: {
      id: account.id,
      plan: account.plan,
      stripeConnected: !!account.stripeCustomerId,
      createdAt: account.createdAt,
    },
    payments: recentPayments,
    stripeEnabled: stripeEnabled(),
  });
});

// POST /billing/upgrade — upgrade plan (stub)
billingRouter.post("/upgrade", requireAuth, async (c) => {
  const userId = c.get("userId");
  const { plan } = await c.req.json<{ plan: string }>();

  if (!["free", "pro", "enterprise"].includes(plan)) {
    return c.json({ error: "Invalid plan", code: "VALIDATION" }, 400);
  }

  let account = db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.userId, userId))
    .get();

  if (!account) {
    const id = nanoid();
    db.insert(billingAccounts).values({ id, userId, plan: "free" }).run();
    account = db.select().from(billingAccounts).where(eq(billingAccounts.id, id)).get()!;
  }

  if (stripeEnabled()) {
    // In production: create Stripe checkout session
    // const session = await stripe.checkout.sessions.create({ ... });
    // return c.json({ checkoutUrl: session.url });
    return c.json({
      error: "Stripe checkout not yet implemented — set up webhook handler",
      code: "NOT_IMPLEMENTED",
    }, 501);
  }

  // Dev mode: instant upgrade
  db.update(billingAccounts)
    .set({ plan, updatedAt: sql`datetime('now')` })
    .where(eq(billingAccounts.userId, userId))
    .run();

  // Record mock payment
  if (plan !== "free") {
    const amount = plan === "pro" ? 29.0 : 99.0;
    db.insert(payments)
      .values({
        id: nanoid(),
        userId,
        amount,
        currency: "usd",
        status: "completed",
        description: `Upgrade to ${plan} plan`,
      })
      .run();
  }

  return c.json({ ok: true, plan });
});

// POST /billing/connect — connect Stripe for payouts (agent creators)
billingRouter.post("/connect", requireAuth, async (c) => {
  const userId = c.get("userId");

  if (stripeEnabled()) {
    // In production: create Stripe Connect onboarding link
    return c.json({
      error: "Stripe Connect not yet implemented",
      code: "NOT_IMPLEMENTED",
    }, 501);
  }

  // Dev mode: mock connect
  let account = db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.userId, userId))
    .get();

  if (!account) {
    const id = nanoid();
    db.insert(billingAccounts).values({ id, userId, plan: "free" }).run();
    account = db.select().from(billingAccounts).where(eq(billingAccounts.id, id)).get()!;
  }

  db.update(billingAccounts)
    .set({ stripeConnectId: `acct_mock_${nanoid(8)}`, updatedAt: sql`datetime('now')` })
    .where(eq(billingAccounts.userId, userId))
    .run();

  return c.json({ ok: true, connected: true });
});

// GET /billing/revenue — creator revenue summary
billingRouter.get("/revenue", requireAuth, async (c) => {
  const userId = c.get("userId");

  // Get all active agents by this user
  const myAgents = db
    .select({ id: agents.id, name: agents.name, slug: agents.slug, pricing: agents.pricing, pricePerCall: agents.pricePerCall, monthlyPrice: agents.monthlyPrice })
    .from(agents)
    .where(eq(agents.creatorId, userId))
    .all();

  const revenue = myAgents.map((agent) => {
    const activeSubs = db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptions)
      .where(
        eq(subscriptions.agentId, agent.id),
      )
      .get();

    let estimated = 0;
    if (agent.pricing === "monthly") {
      estimated = (activeSubs?.count || 0) * (agent.monthlyPrice || 0);
    }
    // For usage-based, revenue comes from usage logs (already tracked elsewhere)

    return {
      agentId: agent.id,
      agentName: agent.name,
      agentSlug: agent.slug,
      pricing: agent.pricing,
      activeSubscribers: activeSubs?.count || 0,
      estimatedMonthlyRevenue: estimated,
    };
  });

  const total = revenue.reduce((s, r) => s + r.estimatedMonthlyRevenue, 0);

  return c.json({ agents: revenue, totalEstimatedMonthly: total });
});

export default billingRouter;
