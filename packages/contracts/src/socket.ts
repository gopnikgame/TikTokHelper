import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

const identifierPattern = '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$';
const commandIdPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const tiktokUsernamePattern = '^@?[A-Za-z0-9._]{2,24}$';
const commandProperties = {
  commandId: { type: 'string', pattern: commandIdPattern },
  workspaceId: { type: 'string', pattern: identifierPattern },
} as const;

export const subscribeWorkspaceCommandSchema = {
  $id: 'SubscribeWorkspaceCommand', type: 'object', additionalProperties: false,
  required: ['commandId', 'workspaceId'],
  properties: {
    ...commandProperties,
    generation: { type: 'integer', minimum: 0 },
    lastSequence: { type: 'integer', minimum: 0 },
  },
} as const;

export const connectLiveCommandSchema = {
  $id: 'ConnectLiveCommand', type: 'object', additionalProperties: false,
  required: ['commandId', 'workspaceId', 'tiktokUsername'],
  properties: { ...commandProperties, tiktokUsername: { type: 'string', pattern: tiktokUsernamePattern } },
} as const;

export const disconnectLiveCommandSchema = {
  $id: 'DisconnectLiveCommand', type: 'object', additionalProperties: false,
  required: ['commandId', 'workspaceId'], properties: commandProperties,
} as const;

export interface WorkspaceCommand { commandId: string; workspaceId: string; }
export interface ConnectLiveCommand extends WorkspaceCommand { tiktokUsername: string; }
export interface SubscribeWorkspaceCommand extends WorkspaceCommand {
  generation?: number;
  lastSequence?: number;
}
export type DisconnectLiveCommand = WorkspaceCommand;

export interface CommandError {
  code: 'FORBIDDEN' | 'INVALID_COMMAND' | 'NOT_READY' | 'INTERNAL_ERROR';
  message: string;
}
export type CommandAcknowledgement = { ok: true; duplicate?: boolean } | { ok: false; error: CommandError };

export interface ClientToServerEvents {
  'workspace:subscribe': (payload: SubscribeWorkspaceCommand, acknowledge: (result: CommandAcknowledgement) => void) => void;
  'live:connect': (payload: ConnectLiveCommand, acknowledge: (result: CommandAcknowledgement) => void) => void;
  'live:disconnect': (payload: DisconnectLiveCommand, acknowledge: (result: CommandAcknowledgement) => void) => void;
}

export interface ClientEventPayloads {
  'workspace:subscribe': SubscribeWorkspaceCommand;
  'live:connect': ConnectLiveCommand;
  'live:disconnect': DisconnectLiveCommand;
}

export const clientEventSchemas = {
  'workspace:subscribe': subscribeWorkspaceCommandSchema,
  'live:connect': connectLiveCommandSchema,
  'live:disconnect': disconnectLiveCommandSchema,
} as const;

export type ClientEventName = keyof ClientEventPayloads;
export type ContractValidationResult<T> = { ok: true; value: T } | { ok: false; errors: ErrorObject[] };

const ajv = new Ajv({ allErrors: false, removeAdditional: false });
const clientEventValidators = Object.fromEntries(
  Object.entries(clientEventSchemas).map(([eventName, schema]) => [eventName, ajv.compile(schema)]),
) as Record<ClientEventName, ValidateFunction>;

export function validateClientEvent<EventName extends ClientEventName>(
  eventName: EventName,
  payload: unknown,
): ContractValidationResult<ClientEventPayloads[EventName]> {
  const validator = clientEventValidators[eventName];
  return validator(payload)
    ? { ok: true, value: payload as ClientEventPayloads[EventName] }
    : { ok: false, errors: validator.errors ?? [] };
}

export interface ConnectionStateEvent {
  type: 'connection.state'; generation: number; sequence: number;
  state: 'stopped' | 'connecting' | 'live' | 'reconnecting' | 'offline' | 'failed';
}
export interface ChatEvent {
  type: 'chat.message'; generation: number; sequence: number; eventId: string;
  senderDisplayName: string; senderUsername: string; text: string;
}
export interface GiftEvent {
  type: 'gift.received'; generation: number; sequence: number; eventId: string;
  giftId: string; giftName: string; senderDisplayName: string; repeatCount: number;
  imageUrl?: string; diamondCount?: number;
}
export type RealtimeEvent = ConnectionStateEvent | ChatEvent | GiftEvent;
export interface RealtimeSnapshot {
  workspaceId: string; generation: number; lastSequence: number;
  connectionState: ConnectionStateEvent['state'];
  replay: RealtimeEvent[];
  requiresFullRefresh: boolean;
}
export interface ServerToClientEvents {
  snapshot: (snapshot: RealtimeSnapshot) => void;
  event: (event: RealtimeEvent) => void;
}
