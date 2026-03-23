import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { Config } from '../config.js';
import type {
  PolymarketWsEvent,
  PolymarketWsBookEvent,
  PolymarketWsBestBidAskEvent,
  PolymarketWsLastTradePriceEvent,
} from './types.js';
import type { PriceUpdate } from '../types.js';
import { createLogger } from '../logger.js';
import { PolymarketWsEventSchema } from '../validation.js';

const logger = createLogger('polymarket-ws');

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;

/** Convert a Polymarket dollar price string to cents */
function dollarsToCents(dollars: string): number {
  return Math.round(parseFloat(dollars) * 100);
}

export class PolymarketWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private subscribedTokenIds: Set<string> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(config: Config) {
    super();
    this.wsUrl = config.polymarketWsUrl;
  }

  connect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    logger.info(`Connecting to Polymarket WebSocket: ${this.wsUrl}`);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      logger.info('Polymarket WebSocket connected');
      this.reconnectAttempts = 0;
      this.resubscribe();
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        // Polymarket may send arrays of events
        const rawEvents = Array.isArray(parsed) ? parsed : [parsed];
        for (const rawEvent of rawEvents) {
          const validated = PolymarketWsEventSchema.safeParse(rawEvent);
          if (!validated.success) {
            logger.warn('Invalid Polymarket WS event structure', { error: validated.error.message });
            continue;
          }
          this.handleEvent(rawEvent as PolymarketWsEvent);
        }
      } catch (err) {
        logger.error('Failed to parse Polymarket WS message', { error: err });
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(`Polymarket WebSocket closed: ${code} ${reason.toString()}`);
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error('Polymarket WebSocket error', { error: err.message });
    });

    this.ws.on('ping', () => {
      this.ws?.pong();
    });
  }

  subscribe(tokenIds: string[]): void {
    for (const id of tokenIds) {
      this.subscribedTokenIds.add(id);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(tokenIds);
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private sendSubscribe(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      type: 'market',
      assets_ids: tokenIds,
      custom_feature_enabled: true,
    };
    this.ws.send(JSON.stringify(msg));
    logger.info(`Subscribed to ${tokenIds.length} Polymarket token IDs`);
  }

  private resubscribe(): void {
    const ids = Array.from(this.subscribedTokenIds);
    if (ids.length > 0) {
      this.sendSubscribe(ids);
    }
  }

  private handleEvent(event: PolymarketWsEvent): void {
    if (!event.event_type) return;

    switch (event.event_type) {
      case 'book': {
        const bookEvent = event as PolymarketWsBookEvent;
        const bestBid = bookEvent.bids?.[0]?.price;
        const bestAsk = bookEvent.asks?.[0]?.price;

        if (bestBid || bestAsk) {
          const update: PriceUpdate = {
            platform: 'polymarket',
            ticker: bookEvent.asset_id,
            yesBid: bestBid ? dollarsToCents(bestBid) : undefined,
            yesAsk: bestAsk ? dollarsToCents(bestAsk) : undefined,
            timestamp: bookEvent.timestamp || new Date().toISOString(),
          };
          this.emit('priceUpdate', update);
        }
        this.emit('book', bookEvent);
        break;
      }
      case 'best_bid_ask': {
        const bbaEvent = event as PolymarketWsBestBidAskEvent;
        const update: PriceUpdate = {
          platform: 'polymarket',
          ticker: bbaEvent.asset_id,
          yesBid: dollarsToCents(bbaEvent.best_bid),
          yesAsk: dollarsToCents(bbaEvent.best_ask),
          timestamp: bbaEvent.timestamp || new Date().toISOString(),
        };
        this.emit('priceUpdate', update);
        break;
      }
      case 'last_trade_price': {
        const ltpEvent = event as PolymarketWsLastTradePriceEvent;
        const update: PriceUpdate = {
          platform: 'polymarket',
          ticker: ltpEvent.asset_id,
          lastPrice: dollarsToCents(ltpEvent.price),
          timestamp: ltpEvent.timestamp || new Date().toISOString(),
        };
        this.emit('priceUpdate', update);
        break;
      }
      case 'price_change': {
        this.emit('priceChange', event);
        break;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    const backoff = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, this.reconnectAttempts),
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempts++;

    logger.info(`Reconnecting to Polymarket WS in ${backoff}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, backoff);
  }
}
