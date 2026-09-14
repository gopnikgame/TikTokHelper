import { createHash } from 'node:crypto';
import type { ChatEmote, ChatEvent, GiftEvent } from '@tiktok-helper/contracts';

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

function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function chatEmotes(value: unknown): ChatEmote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((itemValue) => {
    const item = record(itemValue);
    const emote = record(item?.emote);
    const emoteId = text(emote?.emoteId) ?? text(item?.emoteId);
    const imageUrl = firstImageUrl(emote?.image) ?? httpUrl(item?.emoteImageUrl);
    const position = nonNegativeInteger(item?.index ?? item?.placeInComment);
    return emoteId && imageUrl && position !== undefined ? [{ emoteId, imageUrl, position }] : [];
  }).slice(0, 50);
}

function httpUrl(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate || candidate.length > 2048) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch { return undefined; }
}

function firstImageUrl(...values: unknown[]): string | undefined {
  for (const value of values) {
    const image = record(value);
    const urls = image?.urlList ?? image?.url_list;
    if (Array.isArray(urls)) {
      for (const item of urls) { const url = httpUrl(item); if (url) return url; }
    }
  }
  return undefined;
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
  const emotes = chatEmotes(raw.emotes);
  return {
    type: 'chat.message', generation, sequence,
    eventId: eventId(raw, ['chat', author.username, comment]),
    senderDisplayName: author.displayName, senderUsername: author.username, text: comment,
    ...(emotes.length > 0 ? { emotes } : {}),
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
  const gift = record(raw.gift);
  const extendedGift = record(raw.extendedGiftInfo);
  const giftId = text(raw.giftId);
  const repeatCount = positiveInteger(raw.repeatCount) ?? 1;
  if (!author || !giftId) return undefined;
  const streakable = Number(giftDetails?.giftType) === 1;
  return {
    type: 'gift.received', generation, sequence,
    eventId: eventId(raw, ['gift', author.username, giftId, String(repeatCount), String(Boolean(raw.repeatEnd))]),
    giftId, giftName: text(gift?.name) ?? text(giftDetails?.giftName) ?? text(extendedGift?.name) ?? giftId,
    senderDisplayName: author.displayName, repeatCount,
    imageUrl: firstImageUrl(gift?.image, gift?.icon, gift?.previewImage, giftDetails?.giftImage, extendedGift?.image),
    diamondCount: nonNegativeInteger(gift?.diamondCount ?? giftDetails?.diamondCount ?? raw.diamondCount),
    repeatEnd: Boolean(raw.repeatEnd), streakable,
  };
}
