import { createHash } from 'node:crypto';
import type { ChatEvent, GiftEvent } from '@tiktok-helper/contracts';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function eventId(raw: UnknownRecord, parts: string[]): string {
  const common = record(raw.common);
  const supplied = text(common?.msgId) ?? text(raw.msgId);
  if (supplied) return supplied;
  return createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 40);
}

function sender(raw: UnknownRecord): { displayName: string; username: string } | undefined {
  const user = record(raw.user);
  const username = text(user?.uniqueId) ?? text(user?.displayId) ?? text(user?.idStr) ?? text(user?.id);
  if (!username) return undefined;
  return { displayName: text(user?.nickname) ?? username, username };
}

export function normalizeChat(rawValue: unknown, generation: number, sequence: number): ChatEvent | undefined {
  const raw = record(rawValue);
  if (!raw) return undefined;
  const author = sender(raw);
  const comment = text(raw.comment) ?? text(raw.content);
  if (!author || !comment) return undefined;
  return {
    type: 'chat.message', generation, sequence,
    eventId: eventId(raw, ['chat', author.username, comment]),
    senderDisplayName: author.displayName, senderUsername: author.username, text: comment,
  };
}

export interface NormalizedGift extends GiftEvent {
  repeatEnd: boolean;
  streakable: boolean;
}

export function normalizeGift(rawValue: unknown, generation: number, sequence: number): NormalizedGift | undefined {
  const raw = record(rawValue);
  if (!raw) return undefined;
  const author = sender(raw);
  const giftDetails = record(raw.giftDetails);
  const giftId = text(raw.giftId);
  const repeatCount = positiveInteger(raw.repeatCount) ?? 1;
  if (!author || !giftId) return undefined;
  const streakable = Number(giftDetails?.giftType) === 1;
  return {
    type: 'gift.received', generation, sequence,
    eventId: eventId(raw, ['gift', author.username, giftId, String(repeatCount), String(Boolean(raw.repeatEnd))]),
    giftId, giftName: text(giftDetails?.giftName) ?? text(record(raw.extendedGiftInfo)?.name) ?? giftId,
    senderDisplayName: author.displayName, repeatCount,
    repeatEnd: Boolean(raw.repeatEnd), streakable,
  };
}
