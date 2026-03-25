import type { ArbOpportunity } from '../arb/types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('discord');

interface DiscordEmbed {
  title: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  timestamp: string;
}

function buildEmbed(opp: ArbOpportunity, polyQuestion?: string): DiscordEmbed {
  const marketName = polyQuestion || opp.polymarketId;
  const spreadPct = opp.bestSpreadCents > 0
    ? ((opp.bestSpreadCents / 100) * 100).toFixed(1)
    : '0.0';

  return {
    title: 'Arb Opportunity Detected',
    color: 65280, // green
    fields: [
      {
        name: 'Market',
        value: `**Polymarket**: ${marketName}`,
        inline: false,
      },
      {
        name: 'Polymarket',
        value: `YES bid: ${opp.polyYesBid}¢ / ask: ${opp.polyYesAsk}¢\nNO bid: ${opp.polyNoBid}¢ / ask: ${opp.polyNoAsk}¢`,
        inline: true,
      },
      {
        name: 'Spread',
        value: `Gross: ${opp.bestSpreadCents}¢ (${spreadPct}%)\nNet: ${opp.netSpreadCents}¢ (after ~${opp.estimatedFeesCents}¢ fees)`,
        inline: true,
      },
      {
        name: 'Strategy',
        value: opp.strategy,
        inline: false,
      },
      {
        name: 'Depth',
        value: opp.availableDepthDollars > 0 ? `$${opp.availableDepthDollars.toFixed(0)}` : 'Unknown',
        inline: true,
      },
    ],
    timestamp: opp.detectedAt,
  };
}

export async function sendDiscordAlert(
  webhookUrl: string,
  opp: ArbOpportunity,
  polyQuestion?: string,
): Promise<void> {
  if (!webhookUrl) {
    logger.debug('No Discord webhook URL configured, skipping alert');
    return;
  }

  const embed = buildEmbed(opp, polyQuestion);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.error(`Discord webhook failed: ${response.status} ${body}`);
    } else {
      logger.info('Discord alert sent successfully');
    }
  } catch (err) {
    logger.error('Failed to send Discord alert', { error: (err as Error).message });
  }
}
