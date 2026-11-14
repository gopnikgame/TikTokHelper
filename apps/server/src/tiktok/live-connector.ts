import {
  ControlEvent, TikTokLiveConnection, UserOfflineError, WebcastEvent,
  type ProtoMessageFetchResult, type TikTokLiveConstructorConnectionOptions,
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

class HistoryAwareLiveConnection extends TikTokLiveConnection {
  readonly #historicalEvents = new WeakSet<object>();

  isHistorical(event: unknown): boolean {
    return typeof event === 'object' && event !== null && this.#historicalEvents.has(event);
  }

  protected override processProtoMessageFetchResult(batch: ProtoMessageFetchResult): Promise<void> {
    // v2.5.0 processes the initial signing batch before creating the WebSocket client.
    // The upstream data callbacks receive the decoded objects without this envelope.
    const initialBatch = this.wsClient === null;
    for (const message of batch.messages) {
      if (!initialBatch && message.isHistory !== true) continue;
      const event = message.decodedData?.data;
      if (typeof event === 'object' && event !== null) this.#historicalEvents.add(event);
    }
    return super.processProtoMessageFetchResult(batch);
  }
}

class TikTokConnector implements LiveConnector {
  readonly #connection: HistoryAwareLiveConnection;

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
    this.#connection = new HistoryAwareLiveConnection(username, options);
  }

  async connect(): Promise<string | undefined> {
    try {
      const { roomId } = await this.#connection.connect();
      const id = typeof roomId === 'string' ? roomId.trim() : '';
      return id && id !== '0' ? id : undefined;
    } catch (error) {
      // In 2.5.0 a rejected WebSocket upgrade can leave the handshake socket open.
      this.#cancelHandshake();
      if (error instanceof UserOfflineError) {
        throw new Error('TIKTOK_USER_OFFLINE', { cause: error });
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.#cancelHandshake();
    await this.#connection.disconnect();
  }

  #cancelHandshake(): void {
    const wsClient = this.#connection.wsClient as unknown as RuntimeWebSocket | null;
    if (wsClient && wsClient.readyState === wsClient.CONNECTING) wsClient.terminate();
  }

  on<EventName extends keyof ConnectorEventMap>(
    eventName: EventName,
    handler: (event: ConnectorEventMap[EventName], historical?: boolean) => void,
  ): void {
    const events = {
      connected: ControlEvent.CONNECTED,
      disconnected: ControlEvent.DISCONNECTED,
      error: ControlEvent.ERROR,
      chat: WebcastEvent.CHAT,
      gift: WebcastEvent.GIFT,
      roomUser: WebcastEvent.ROOM_USER,
      like: WebcastEvent.LIKE,
      follow: WebcastEvent.FOLLOW,
      share: WebcastEvent.SHARE,
      streamEnd: WebcastEvent.STREAM_END,
    } as const;
    const emitter = this.#connection as unknown as RuntimeEmitter;
    if (eventName !== 'connected' && eventName !== 'disconnected' && eventName !== 'error' && eventName !== 'streamEnd') {
      emitter.on(events[eventName], (event) => handler(
        event as ConnectorEventMap[EventName], this.#connection.isHistorical(event) || undefined,
      ));
    } else {
      emitter.on(events[eventName], handler as (event: unknown) => void);
    }
  }

  removeAllListeners(): void { (this.#connection as unknown as RuntimeEmitter).removeAllListeners(); }
}

export function createTikTokConnectorFactory(proxyUrl?: string): LiveConnectorFactory {
  const proxy = readProxyUrl(proxyUrl);
  return (username) => new TikTokConnector(username, createProxyOptions(proxy));
}
