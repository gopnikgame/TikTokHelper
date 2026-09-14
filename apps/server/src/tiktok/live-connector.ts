import {
  ControlEvent, TikTokLiveConnection, UserOfflineError, WebcastEvent,
  type TikTokLiveConstructorConnectionOptions,
} from 'tiktok-live-connector';
import { ProxyAgent } from 'proxy-agent';
import type { ConnectorEventMap, LiveConnector, LiveConnectorFactory } from './types.js';

interface RuntimeEmitter {
  on(eventName: string, handler: (event: unknown) => void): void;
  removeAllListeners(): void;
}

export class TikTokConnector implements LiveConnector {
  readonly #connection: TikTokLiveConnection;

  constructor(username: string, proxyUrl?: string) {
    const proxyAgent = proxyUrl ? new ProxyAgent({ getProxyForUrl: () => proxyUrl }) : undefined;
    const options = {
      // The signed extended gift-catalogue request is optional and can fail even while
      // the LIVE WebSocket is available. Gift events still carry their own identifiers.
      enableExtendedGiftInfo: false,
      processInitialData: false,
      ...(proxyAgent ? {
        webClientOptions: { agent: { http: proxyAgent, https: proxyAgent, http2: proxyAgent }, http2: false },
        wsClientOptions: { agent: proxyAgent },
      } : {}),
    } as unknown as TikTokLiveConstructorConnectionOptions;
    this.#connection = new TikTokLiveConnection(username, options);
  }

  async connect(): Promise<void> {
    try {
      await this.#connection.connect();
    } catch (error) {
      if (error instanceof UserOfflineError) {
        throw new Error('TIKTOK_USER_OFFLINE', { cause: error });
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> { await this.#connection.disconnect(); }

  on<EventName extends keyof ConnectorEventMap>(
    eventName: EventName,
    handler: (event: ConnectorEventMap[EventName]) => void,
  ): void {
    const events = {
      connected: ControlEvent.CONNECTED,
      disconnected: ControlEvent.DISCONNECTED,
      error: ControlEvent.ERROR,
      chat: WebcastEvent.CHAT,
      gift: WebcastEvent.GIFT,
      streamEnd: WebcastEvent.STREAM_END,
    } as const;
    (this.#connection as unknown as RuntimeEmitter).on(events[eventName], handler as (event: unknown) => void);
  }

  removeAllListeners(): void { (this.#connection as unknown as RuntimeEmitter).removeAllListeners(); }
}

export const createTikTokConnector: LiveConnectorFactory = (username) => new TikTokConnector(
  username, process.env.TIKTOK_PROXY_URL,
);
