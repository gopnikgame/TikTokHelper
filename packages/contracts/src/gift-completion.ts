/** Live-only notification for a single gift or its first series final. */
export interface GiftCompletedEvent {
  eventId: string;
  workspaceId: string;
  connectionId: string;
  generation: number;
  giftId: string;
  giftName: string;
  senderDisplayName: string;
  senderUsername: string;
  repeatCount: number;
  diamondCount?: number;
}

const allowedFields = new Set<string>([
  'eventId', 'workspaceId', 'connectionId', 'generation', 'giftId', 'giftName',
  'senderDisplayName', 'senderUsername', 'repeatCount', 'diamondCount',
] satisfies (keyof GiftCompletedEvent)[]);
const workspaceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const connectionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function isGiftCompletedEvent(value: unknown): value is GiftCompletedEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<Record<keyof GiftCompletedEvent, unknown>>;
  return Object.keys(event).every((key) => allowedFields.has(key))
    && typeof event.workspaceId === 'string' && workspaceIdPattern.test(event.workspaceId)
    && typeof event.connectionId === 'string' && connectionIdPattern.test(event.connectionId)
    && boundedText(event.eventId, 160) && boundedText(event.giftId, 80) && boundedText(event.giftName, 160)
    && boundedText(event.senderDisplayName, 120) && boundedText(event.senderUsername, 64)
    && boundedInteger(event.generation, 1, Number.MAX_SAFE_INTEGER)
    && boundedInteger(event.repeatCount, 1, 2_147_483_647)
    && (event.diamondCount === undefined || boundedInteger(event.diamondCount, 0, 2_147_483_647));
}
