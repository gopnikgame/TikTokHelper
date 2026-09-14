import type { RealtimeEvent } from '@tiktok-helper/contracts';

export type LiveConnectionState = 'stopped' | 'connecting' | 'live' | 'reconnecting' | 'offline' | 'failed';

export interface ConnectorEventMap {
  connected: unknown;
  disconnected: { code?: number; reason?: string };
  error: unknown;
  chat: unknown;
  gift: unknown;
  streamEnd: unknown;
}

export interface LiveConnector {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on<EventName extends keyof ConnectorEventMap>(
    eventName: EventName,
    handler: (event: ConnectorEventMap[EventName]) => void,
  ): void;
  removeAllListeners(): void;
}

export type LiveConnectorFactory = (username: string) => LiveConnector;
export type RealtimeEventSink = (workspaceId: string, event: RealtimeEvent) => void;

export interface LiveSessionSnapshot {
  workspaceId: string;
  tiktokUsername: string | null;
  generation: number;
  lastSequence: number;
  state: LiveConnectionState;
}
