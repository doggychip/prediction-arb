/**
 * Notification service — creates in-app notifications and dispatches webhooks.
 */

import { eq, and } from "drizzle-orm";
import { createHmac } from "crypto";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { notifications, webhooks } from "../../shared/schema.js";

type EventType = "subscription.created" | "review.created" | "health.changed";

interface NotificationPayload {
  userId: string;
  type: EventType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

/** Create an in-app notification and fire any matching webhooks */
export async function notify(payload: NotificationPayload) {
  const id = nanoid();

  // 1. Store in-app notification
  db.insert(notifications)
    .values({
      id,
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body || null,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
    })
    .run();

  // 2. Fire webhooks (async, non-blocking)
  fireWebhooks(payload).catch((err) => {
    console.error(`[notify] Failed to fire webhooks for user ${payload.userId}:`, err);
  });

  return id;
}

async function fireWebhooks(payload: NotificationPayload) {
  const userWebhooks = db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.userId, payload.userId),
        eq(webhooks.active, true)
      )
    )
    .all();

  for (const wh of userWebhooks) {
    const events: string[] = JSON.parse(wh.events);
    if (!events.includes(payload.type)) continue;

    const body = JSON.stringify({
      id: nanoid(),
      type: payload.type,
      timestamp: new Date().toISOString(),
      data: {
        title: payload.title,
        body: payload.body,
        ...(payload.metadata || {}),
      },
    });

    const signature = createHmac("sha256", wh.secret)
      .update(body)
      .digest("hex");

    try {
      await fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Webhook delivery failures are silent — could add retry queue later
    }
  }
}
