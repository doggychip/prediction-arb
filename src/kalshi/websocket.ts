import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { Config } from '../config.js';
import type { KalshiWsMessage, KalshiWsSubscribeMessage } from './types.js';
import { kalshiDollarsToCents } from './types.js';
import type { PriceUpdate } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('kalshi-ws');

const MAX_BACKOFF_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;

export class KalshiWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private subscribedTickers: Set<string> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageId = 0;
  private closed = false;

  constructor(config: Config) {
    super();
    this.wsUrl = config.kalshiWsUrl;
  }

  connect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    logger.info(`Connecting to Kalshi WebSocket: ${this.wsUrl}`);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      logger.info('Kalshi WebSocket connected');
      this.reconnectAttempts = 0;
      this.resubscribe();
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString()) as KalshiWsMessage;
        this.handleMessage(msg);
      } catch (err) {
        logger.error('Failed to parse Kalshi WS message', { error: err });
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(`Kalshi WebSocket closed: ${code} ${reason.toString()}`);
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error('Kalshi WebSocket error', { error: err.message });
    });

    this.ws.on('ping', () => {
      this.ws?.pong();
    });
  }

  subscribe(tickers: string[]): void {
    for (const t of tickers) {
      this.subscribedTickers.add(t);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(tickers, ['ticker', 'trade']);
    }
  }

  unsubscribe(tickers: string[]): void {
    for (const t of tickers) {
      this.subscribedTickers.delete(t);
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg: KalshiWsSubscribeMessage = {
        id: ++this.messageId,
        cmd: 'unsubscribe',
        params: {
          channels: ['ticker', 'trade'],
          market_tickers: tickers,
        },
      };
      this.ws.send(JSON.stringify(msg));
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

  private sendSubscribe(tickers: string[], channels: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg: KalshiWsSubscribeMessage = {
      id: ++this.messageId,
      cmd: 'subscribe',
      params: {
        channels,
        market_tickers: tickers,
      },
    };
    this.ws.send(JSON.stringify(msg));
    logger.info(`Subscribed to ${tickers.length} Kalshi tickers`);
  }

  private resubscribe(): void {
    const tickers = Array.from(this.subscribedTickers);
    if (tickers.length > 0) {
      this.sendSubscribe(tickers, ['ticker', 'trade']);
    }
  }

  private handleMessage(msg: KalshiWsMessage): void {
    if (!msg.type || !msg.msg) return;

    switch (msg.type) {
      case 'ticker': {
        const data = msg.msg;
        const update: PriceUpdate = {
          platform: 'kalshi',
          ticker: data.market_ticker,
          yesBid: kalshiDollarsToCents(data.yes_bid_dollars),
          yesAsk: kalshiDollarsToCents(data.yes_ask_dollars),
          noBid: kalshiDollarsToCents(data.no_bid_dollars),
          noAsk: kalshiDollarsToCents(data.no_ask_dollars),
          lastPrice: kalshiDollarsToCents(data.last_price_dollars),
          timestamp: new Date().toISOString(),
        };
        this.emit('priceUpdate', update);
        break;
      }
      case 'trade': {
        this.emit('trade', msg.msg);
        break;
      }
      case 'orderbook_snapshot': {
        this.emit('orderbookSnapshot', msg.msg);
        break;
      }
      case 'orderbook_delta': {
        this.emit('orderbookDelta', msg.msg);
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

    logger.info(`Reconnecting to Kalshi WS in ${backoff}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, backoff);
  }
}
