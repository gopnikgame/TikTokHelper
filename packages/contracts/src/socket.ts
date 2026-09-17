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
  emotes?: ChatEmote[];
  participant?: ChatParticipantDiagnostic;
  language?: string;
  mentionedUsernames?: string[];
  speakerContext?: ChatSpeakerContext;
}
export interface SpeechLevelEntitlement {
  levelId: string;
  levelName: string;
  cooldownSeconds: number;
  expiresAt: string | null;
}
export interface ChatSpeakerContext {
  isModerator: boolean;
  isGiftGiver: boolean;
  speechLevels: SpeechLevelEntitlement[];
}
export interface ChatEmote { emoteId: string; imageUrl: string; position: number; }
export interface ChatParticipantDiagnostic {
  userId?: string;
  avatarUrl?: string;
  secUidAvailable: boolean;
  verified?: boolean;
  follower?: boolean;
  mutualFollow?: boolean;
  moderator?: boolean;
  subscriber?: boolean;
  anchor?: boolean;
  giftGiver?: boolean;
  followerCount?: number;
  followingCount?: number;
  gifterLevel?: number;
  fanClubName?: string;
  fanClubLevel?: number;
}
export interface GiftEvent {
  type: 'gift.received'; generation: number; sequence: number; eventId: string;
  giftId: string; giftName: string; senderDisplayName: string; senderUsername: string; repeatCount: number;
  imageUrl?: string; diamondCount?: number;
}
export interface SupportLevelGrantedEvent {
  eventId: string;
  workspaceId: string;
  senderDisplayName: string;
  senderUsername: string;
  levelId: string;
  levelName: string;
  thresholdPoints: number;
  pointsAdded: number;
  streamTotal: number;
  lifetimeTotal: number;
  expiresAt: string | null;
}

const uuidSchema = { type: 'string', format: 'uuid' } as const;
export const speechLevelEntitlementSchema = {
  type: 'object', additionalProperties: false,
  required: ['levelId', 'levelName', 'cooldownSeconds', 'expiresAt'],
  properties: {
    levelId: uuidSchema,
    levelName: { type: 'string', minLength: 1, maxLength: 80 },
    cooldownSeconds: { type: 'integer', minimum: 5, maximum: 3600 },
    expiresAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  },
} as const;

export const chatSpeakerContextSchema = {
  type: 'object', additionalProperties: false,
  required: ['isModerator', 'isGiftGiver', 'speechLevels'],
  properties: {
    isModerator: { type: 'boolean' },
    isGiftGiver: { type: 'boolean' },
    speechLevels: { type: 'array', maxItems: 20, items: speechLevelEntitlementSchema },
  },
} as const;

export const supportLevelGrantedEventSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'eventId', 'workspaceId', 'senderDisplayName', 'senderUsername', 'levelId', 'levelName',
    'thresholdPoints', 'pointsAdded', 'streamTotal', 'lifetimeTotal', 'expiresAt',
  ],
  properties: {
    eventId: { type: 'string', minLength: 1, maxLength: 160 },
    workspaceId: { type: 'string', pattern: identifierPattern },
    senderDisplayName: { type: 'string', minLength: 1, maxLength: 120 },
    senderUsername: { type: 'string', minLength: 1, maxLength: 64 },
    levelId: uuidSchema,
    levelName: { type: 'string', minLength: 1, maxLength: 80 },
    thresholdPoints: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
    pointsAdded: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    streamTotal: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    lifetimeTotal: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    expiresAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  },
} as const;
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
  'support:level-granted': (event: SupportLevelGrantedEvent) => void;
  'sound-library:changed': (payload: { soundId: string }) => void;
}
