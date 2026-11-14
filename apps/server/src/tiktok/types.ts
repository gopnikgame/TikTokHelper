import type { RealtimeEvent } from '@tiktok-helper/contracts';

export type LiveConnectionState = 'stopped' | 'connecting' | 'live' | 'reconnecting' | 'offline' | 'failed';

export const LIVE_ACTIVITY_EVENTS = ['roomUser', 'like', 'follow', 'share'] as const;
export type LiveActivityEvent = (typeof LIVE_ACTIVITY_EVENTS)[number];

export interface ConnectorEventMap {
  connected: unknown;
  disconnected: { code?: number; reason?: string };
  error: unknown;
  chat: unknown;
  gift: unknown;
  roomUser: unknown;
  like: unknown;
  follow: unknown;
  share: unknown;
  streamEnd: unknown;
}

export interface LiveConnector {
  connect(): Promise<string | undefined>;
  disconnect(): Promise<void>;
  on<EventName extends keyof ConnectorEventMap>(
    eventName: EventName,
    handler: (event: ConnectorEventMap[EventName], historical?: boolean) => void,
  ): void;
  removeAllListeners(): void;
}

export type LiveConnectorFactory = (username: string) => LiveConnector;
export type RealtimeEventSink = (workspaceId: string, event: RealtimeEvent) => void;

export interface GiftAccounting {
  streak?: { key: string; historicalCount: number; totalCount: number };
  upstreamEventId?: string;
}

export interface LiveSessionSnapshot {
  workspaceId: string;
  tiktokUsername: string | null;
  generation: number;
  lastSequence: number;
  state: LiveConnectionState;
  connectionId?: string;
}
