import { createHash, randomUUID } from 'node:crypto';
import type { ChatEmote, ChatEvent, ChatParticipantDiagnostic, GiftEvent } from '@tiktok-helper/contracts';

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

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function boundedText(value: unknown, maximumLength: number): string | undefined {
  const valueText = text(value);
  return valueText && valueText.length <= maximumLength ? valueText : undefined;
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

function sender(raw: UnknownRecord): { displayName: string; username: string } | undefined {
  const user = record(raw.user);
  const username = text(user?.uniqueId) ?? text(user?.displayId) ?? text(user?.idStr) ?? text(user?.id);
  if (!username) return undefined;
  return { displayName: text(user?.nickname) ?? username, username };
}

function participantDiagnostic(raw: UnknownRecord): ChatParticipantDiagnostic {
  const user = record(raw.user) ?? {};
  const identity = record(raw.userIdentity);
  const followInfo = record(user.followInfo);
  const payGrade = record(user.payGrade);
  const fansClub = record(user.fansClub);
  const fansClubData = record(fansClub?.data);
  const fansClubInfo = record(user.fansClubInfo);
  return {
    secUidAvailable: Boolean(text(user.secUid)),
    ...(boundedText(user.idStr ?? user.id ?? user.userId, 40) ? { userId: boundedText(user.idStr ?? user.id ?? user.userId, 40) } : {}),
    ...(firstImageUrl(user.avatarThumb, user.profilePicture) ? { avatarUrl: firstImageUrl(user.avatarThumb, user.profilePicture) } : {}),
    ...(boolean(user.verified) !== undefined ? { verified: boolean(user.verified) } : {}),
    ...(boolean(identity?.isFollowerOfAnchor) !== undefined ? { follower: boolean(identity?.isFollowerOfAnchor) } : {}),
    ...(boolean(identity?.isMutualFollowingWithAnchor) !== undefined ? { mutualFollow: boolean(identity?.isMutualFollowingWithAnchor) } : {}),
    ...(boolean(identity?.isModeratorOfAnchor ?? user.isModerator) !== undefined ? { moderator: boolean(identity?.isModeratorOfAnchor ?? user.isModerator) } : {}),
    ...(boolean(identity?.isSubscriberOfAnchor ?? user.isSubscriber) !== undefined ? { subscriber: boolean(identity?.isSubscriberOfAnchor ?? user.isSubscriber) } : {}),
    ...(boolean(identity?.isAnchor) !== undefined ? { anchor: boolean(identity?.isAnchor) } : {}),
    ...(boolean(identity?.isGiftGiverOfAnchor) !== undefined ? { giftGiver: boolean(identity?.isGiftGiverOfAnchor) } : {}),
    ...(nonNegativeInteger(followInfo?.followerCount) !== undefined ? { followerCount: nonNegativeInteger(followInfo?.followerCount) } : {}),
    ...(nonNegativeInteger(followInfo?.followingCount) !== undefined ? { followingCount: nonNegativeInteger(followInfo?.followingCount) } : {}),
    ...(nonNegativeInteger(payGrade?.level ?? user.gifterLevel) !== undefined ? { gifterLevel: nonNegativeInteger(payGrade?.level ?? user.gifterLevel) } : {}),
    ...(boundedText(fansClubData?.clubName ?? fansClubInfo?.fansClubName, 80) ? { fanClubName: boundedText(fansClubData?.clubName ?? fansClubInfo?.fansClubName, 80) } : {}),
    ...(nonNegativeInteger(fansClubData?.level ?? fansClubInfo?.fansLevel ?? user.teamMemberLevel) !== undefined
      ? { fanClubLevel: nonNegativeInteger(fansClubData?.level ?? fansClubInfo?.fansLevel ?? user.teamMemberLevel) } : {}),
  };
}

function mentionedUsernames(raw: UnknownRecord): string[] {
  const values = [
    ...(Array.isArray(raw.mentionUsers) ? raw.mentionUsers : []),
    ...(record(raw.atUser) ? [raw.atUser] : []),
  ];
  return [...new Set(values.flatMap((value) => {
    const user = record(value);
    const username = boundedText(user?.displayId ?? user?.uniqueId, 64);
    return username ? [username] : [];
  }))].slice(0, 20);
}

export interface NormalizedChat extends ChatEvent {
  senderIdentityKey: string;
  upstreamEventId?: string;
}

export function normalizeChat(rawValue: unknown, generation: number, sequence: number): NormalizedChat | undefined {
  const raw = record(rawValue);
  if (!raw) return undefined;
  const author = sender(raw);
  const comment = text(raw.comment) ?? text(raw.content);
  if (!author || !comment) return undefined;
  const emotes = chatEmotes(raw.emotes);
  const mentions = mentionedUsernames(raw);
  const language = boundedText(raw.contentLanguage, 16);
  const user = record(raw.user);
  const identitySource = text(user?.secUid) ?? author.username.toLocaleLowerCase('en-US');
  const senderIdentityKey = createHash('sha256').update(identitySource).digest('hex');
  const suppliedEventId = text(record(raw.common)?.msgId) ?? text(raw.msgId);
  const upstreamEventId = suppliedEventId && suppliedEventId !== '0' ? suppliedEventId : undefined;
  return {
    type: 'chat.message', generation, sequence,
    eventId: suppliedEventId ?? createHash('sha256').update(['chat', author.username, comment].join('\u001f')).digest('hex').slice(0, 40),
    ...(upstreamEventId ? { upstreamEventId } : {}),
    senderDisplayName: author.displayName, senderUsername: author.username, senderIdentityKey, text: comment,
    ...(emotes.length > 0 ? { emotes } : {}),
    participant: participantDiagnostic(raw),
    ...(language ? { language } : {}),
    ...(mentions.length > 0 ? { mentionedUsernames: mentions } : {}),
  };
}

export interface NormalizedGift extends GiftEvent {
  repeatEnd: boolean;
  streakable: boolean;
  senderIdentityKey: string;
  groupId?: string;
  occurredAt?: number;
  upstreamEventId?: string;
}

export function tiktokRoomId(value: unknown): string | undefined {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined;
  const id = text(value);
  return id && /^[1-9]\d{0,19}$/.test(id) ? id : undefined;
}

export function messageRoomId(value: unknown): string | undefined {
  return tiktokRoomId(record(record(value)?.common)?.roomId);
}

export function normalizeGift(rawValue: unknown, generation: number, sequence: number): NormalizedGift | undefined {
  const raw = record(rawValue);
  if (!raw) return undefined;
  const author = sender(raw);
  const giftDetails = record(raw.giftDetails);
  const gift = record(raw.gift);
  const extendedGift = record(raw.extendedGiftInfo);
  const giftId = boundedText(raw.giftId, 64);
  const streakable = (positiveInteger(giftDetails?.giftType) ?? positiveInteger(gift?.type)) === 1;
  const suppliedCount = raw.repeatCount;
  const repeatCount = (typeof suppliedCount !== 'boolean' ? positiveInteger(suppliedCount) : undefined) ?? (
    suppliedCount === undefined || (!streakable && (suppliedCount === 0 || suppliedCount === '0')) ? 1 : undefined
  );
  if (!author || !giftId || giftId === '0' || !repeatCount) return undefined;
  const user = record(raw.user);
  const common = record(raw.common);
  const groupId = tiktokRoomId(raw.groupId);
  const occurredAt = positiveInteger(common?.createTime);
  const repeatEnd = raw.repeatEnd === true || raw.repeatEnd === 1 || raw.repeatEnd === '1';
  const suppliedId = boundedText(common?.msgId, 160);
  const messageId = suppliedId && suppliedId !== '0' ? suppliedId : boundedText(raw.msgId, 160);
  const upstreamEventId = messageId && messageId !== '0' ? messageId : undefined;
  const orderId = boundedText(raw.orderId, 160);
  const identitySource = text(user?.secUid) ?? author.username.toLocaleLowerCase('en-US');
  const senderIdentityKey = createHash('sha256').update(identitySource).digest('hex');
  const fallbackIdentity = streakable && groupId ? `group:${groupId}:${repeatCount}:${repeatEnd}`
    : orderId && orderId !== '0' ? `order:${orderId}`
    : occurredAt ? `time:${occurredAt}:${repeatCount}:${repeatEnd}` : undefined;
  return {
    type: 'gift.received', generation, sequence,
    eventId: upstreamEventId ?? (fallbackIdentity
      ? createHash('sha256').update(JSON.stringify([messageRoomId(raw), senderIdentityKey, giftId, fallbackIdentity])).digest('hex')
      : randomUUID()),
    giftId, giftName: text(gift?.name) ?? text(giftDetails?.giftName) ?? text(extendedGift?.name) ?? giftId,
    senderDisplayName: author.displayName, senderUsername: author.username, senderIdentityKey, repeatCount,
    imageUrl: firstImageUrl(gift?.image, gift?.icon, gift?.previewImage, giftDetails?.giftImage, extendedGift?.image),
    diamondCount: nonNegativeInteger(gift?.diamondCount ?? giftDetails?.diamondCount ?? raw.diamondCount),
    repeatEnd, streakable, groupId, occurredAt, upstreamEventId,
  };
}
