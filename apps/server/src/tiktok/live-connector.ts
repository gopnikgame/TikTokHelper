import {
  ControlEvent, TikTokLiveConnection, UserOfflineError, WebcastEvent,
  type TikTokLiveConstructorConnectionOptions,
} from 'tiktok-live-connector';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ConnectorEventMap, LiveConnector, LiveConnectorFactory } from './types.js';

interface RuntimeEmitter {
  on(eventName: string, handler: (event: unknown) => void): void;
  removeAllListeners(): void;
}

interface RuntimeWebSocket {
  readonly readyState: number;
  readonly CONNECTING: number;
  terminate(): void;
}

type ProxyConnectionOptions = Pick<TikTokLiveConstructorConnectionOptions, 'webClientOptions' | 'wsClientOptions'>;

const httpProxyProtocols = new Set(['http:', 'https:']);

function readProxyUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const proxy = URL.parse(value);
  if (!proxy?.hostname ||
      (!httpProxyProtocols.has(proxy.protocol) &&
       !SocksProxyAgent.protocols.some((scheme) => `${scheme}:` === proxy.protocol))) {
    throw new Error('TIKTOK_PROXY_URL must be an HTTP(S) or SOCKS proxy URL');
  }
  try {
    decodeURIComponent(proxy.username);
    decodeURIComponent(proxy.password);
  } catch {
    throw new Error('TIKTOK_PROXY_URL contains invalid proxy credentials');
  }
  return proxy;
}

function createProxyOptions(proxy: URL | undefined): ProxyConnectionOptions {
  if (!proxy) return {};

  let httpAgent: HttpProxyAgent<string> | SocksProxyAgent;
  let httpsAgent: HttpsProxyAgent<string> | SocksProxyAgent;
  if (httpProxyProtocols.has(proxy.protocol)) {
    httpAgent = new HttpProxyAgent(proxy);
    httpsAgent = new HttpsProxyAgent(proxy);
  } else {
    const socksAgent = new SocksProxyAgent(proxy);
    httpAgent = socksAgent;
    httpsAgent = socksAgent;
  }

  type WebClientOptions = NonNullable<ProxyConnectionOptions['webClientOptions']>;
  const webClientOptions: Omit<WebClientOptions, 'cookieJar'> = {
    agent: { http: httpAgent, https: httpsAgent },
    http2: false,
  };
  return {
    // WebcastHttpClient creates its own cookie jar in 2.5.0.
    webClientOptions: webClientOptions as WebClientOptions,
    wsClientOptions: { agent: httpsAgent },
  };
}

class TikTokConnector implements LiveConnector {
  readonly #connection: TikTokLiveConnection;

  constructor(username: string, proxyOptions: ProxyConnectionOptions) {
    const options: TikTokLiveConstructorConnectionOptions = {
      // The signed extended gift-catalogue request is optional and can fail even while
      // the LIVE WebSocket is available. Gift events still carry their own identifiers.
      enableExtendedGiftInfo: false,
      // Show the recent chat context returned during connection instead of waiting
      // for the next message after the operator opens the dashboard.
      processInitialData: true,
      ...proxyOptions,
    };
    this.#connection = new TikTokLiveConnection(username, options);
  }

  async connect(): Promise<void> {
    try {
      await this.#connection.connect();
    } catch (error) {
      // In 2.5.0 a rejected WebSocket upgrade can leave the handshake socket open.
      const wsClient = this.#connection.wsClient as unknown as RuntimeWebSocket | null;
      if (wsClient && wsClient.readyState === wsClient.CONNECTING) wsClient.terminate();
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

export function createTikTokConnectorFactory(proxyUrl?: string): LiveConnectorFactory {
  const proxy = readProxyUrl(proxyUrl);
  return (username) => new TikTokConnector(username, createProxyOptions(proxy));
}
