import type { ArbOpportunity } from '../arb/types.js';
import type { Config } from '../config.js';
import { createLogger } from '../logger.js';
import { sendDiscordAlert } from './discord.js';

const logger = createLogger('notifier');

function formatAlertText(opp: ArbOpportunity, kalshiTitle?: string, polyQuestion?: string): string {
  const strategy =
    opp.strategy === 'kalshi_yes_poly_no'
      ? 'Buy YES on Kalshi + Buy NO on Polymarket'
      : 'Buy NO on Kalshi + Buy YES on Polymarket';
  const depth =
    opp.availableDepthDollars > 0 ? `$${opp.availableDepthDollars.toFixed(0)}` : 'Unknown';

  return (
    `Arb Opportunity Detected\n` +
    `Market: ${kalshiTitle || opp.kalshiTicker} / ${polyQuestion || opp.polymarketId}\n` +
    `Strategy: ${strategy}\n` +
    `Spread: gross ${opp.bestSpreadCents}¢ / net ${opp.netSpreadCents}¢ (fees ~${opp.estimatedFeesCents}¢)\n` +
    `Kalshi: YES ${opp.kalshiYesBid}/${opp.kalshiYesAsk}¢ NO ${opp.kalshiNoBid}/${opp.kalshiNoAsk}¢\n` +
    `Poly: YES ${opp.polyYesBid}/${opp.polyYesAsk}¢ NO ${opp.polyNoBid}/${opp.polyNoAsk}¢\n` +
    `Depth: ${depth}`
  );
}

async function sendSlackAlert(webhookUrl: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Slack webhook failed: ${response.status} ${body}`);
  }
}

async function sendTelegramAlert(botToken: string, chatId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram API failed: ${response.status} ${body}`);
  }
}

async function sendEmailAlert(smtpUrl: string, to: string, text: string): Promise<void> {
  // Simple SMTP via HTTP relay (e.g. Mailgun, SendGrid, Postmark)
  // Expects SMTP_URL to be a POST endpoint that accepts JSON { to, subject, text }
  const response = await fetch(smtpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      subject: 'Arb Opportunity Detected',
      text,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Email API failed: ${response.status} ${body}`);
  }
}

/**
 * Send alerts to all configured channels.
 * Failures in one channel don't block others.
 */
export async function sendAlerts(
  config: Config,
  opp: ArbOpportunity,
  kalshiTitle?: string,
  polyQuestion?: string,
): Promise<number> {
  const text = formatAlertText(opp, kalshiTitle, polyQuestion);
  let sent = 0;

  const channels: Array<{ name: string; fn: () => Promise<void> }> = [];

  if (config.discordWebhookUrl) {
    channels.push({
      name: 'discord',
      fn: () => sendDiscordAlert(config.discordWebhookUrl, opp, kalshiTitle, polyQuestion),
    });
  }

  if (config.slackWebhookUrl) {
    channels.push({
      name: 'slack',
      fn: () => sendSlackAlert(config.slackWebhookUrl, text),
    });
  }

  if (config.telegramBotToken && config.telegramChatId) {
    channels.push({
      name: 'telegram',
      fn: () => sendTelegramAlert(config.telegramBotToken, config.telegramChatId, text),
    });
  }

  if (config.emailSmtpUrl && config.emailTo) {
    channels.push({
      name: 'email',
      fn: () => sendEmailAlert(config.emailSmtpUrl, config.emailTo, text),
    });
  }

  // Send to all channels in parallel
  const results = await Promise.allSettled(channels.map((ch) => ch.fn()));

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      sent++;
    } else {
      const reason = (results[i] as PromiseRejectedResult).reason;
      logger.error(`${channels[i].name} alert failed`, { error: String(reason) });
    }
  }

  if (sent > 0) {
    logger.info(`Alerts sent to ${sent}/${channels.length} channels`);
  }

  return sent;
}

// Export for testing
export { formatAlertText };
