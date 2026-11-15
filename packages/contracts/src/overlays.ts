import { GIFT_GOAL_MAX_TARGET } from './gift-goal.js';
import { LIKE_GOAL_MAX_TARGET } from './live-activity.js';
import {
  isLivePollContent, LIVE_POLL_MAX_OPTIONS, LIVE_POLL_MAX_VOTERS, LIVE_POLL_MIN_OPTIONS,
  LIVE_POLL_OPTION_MAX_LENGTH, LIVE_POLL_QUESTION_MAX_LENGTH, type LivePollContent,
} from './live-poll.js';

export const GIFT_GOAL_OVERLAY_TOKEN_HEADER = 'x-tiktok-helper-overlay-token';
export const STREAM_OVERLAY_KINDS = ['gift-goal', 'last-gift', 'like-goal', 'live-poll'] as const;
export const LAST_GIFT_OVERLAY_DURATION_MS = 8_000;
export type StreamOverlayKind = (typeof STREAM_OVERLAY_KINDS)[number];

export interface GiftGoalOverlayLink { token: string | null }
export interface SaveGiftGoalOverlayLink { enabled: boolean }

export interface GiftGoalOverlaySnapshot {
  giftName: string | null;
  progress: number;
  targetCount: number;
}

export interface LastGiftOverlaySnapshot {
  giftName: string;
  quantity: number;
  remainingMs: number;
}

export interface LikeGoalOverlaySnapshot {
  progress: number;
  targetCount: number;
}

export type LivePollOverlaySnapshot = LivePollContent;

export interface StreamOverlaySnapshotByKind {
  'gift-goal': GiftGoalOverlaySnapshot;
  'last-gift': LastGiftOverlaySnapshot;
  'like-goal': LikeGoalOverlaySnapshot;
  'live-poll': LivePollOverlaySnapshot;
}

export type StreamOverlaySnapshot = StreamOverlaySnapshotByKind[StreamOverlayKind];

const tokenPattern = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
const giftName = { type: 'string', minLength: 1, maxLength: 160 } as const;
const progress = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const;
const targetCount = { type: 'integer', minimum: 1, maximum: GIFT_GOAL_MAX_TARGET } as const;
const quantity = { type: 'integer', minimum: 1, maximum: 2_147_483_647 } as const;
const remainingMs = { type: 'integer', minimum: 1, maximum: LAST_GIFT_OVERLAY_DURATION_MS } as const;

export const giftGoalOverlayLinkSchema = {
  type: 'object', additionalProperties: false, required: ['token'],
  properties: { token: { anyOf: [{ type: 'string', pattern: tokenPattern.source }, { type: 'null' }] } },
} as const;

export const saveGiftGoalOverlayLinkSchema = {
  type: 'object', additionalProperties: false, required: ['enabled'],
  properties: { enabled: { type: 'boolean' } },
} as const;

function nullableSnapshot(properties: Record<string, unknown>) {
  return {
    type: 'object', nullable: true, additionalProperties: false, required: Object.keys(properties), properties,
  } as const;
}

export const giftGoalOverlaySnapshotSchema = nullableSnapshot({
  giftName: { anyOf: [giftName, { type: 'null' }] }, progress, targetCount,
});

export const streamOverlaySnapshotSchemas = {
  'gift-goal': giftGoalOverlaySnapshotSchema,
  'last-gift': nullableSnapshot({ giftName, quantity, remainingMs }),
  'like-goal': nullableSnapshot({ progress, targetCount: { ...targetCount, maximum: LIKE_GOAL_MAX_TARGET } }),
  'live-poll': nullableSnapshot({
    question: { type: 'string', minLength: 1, maxLength: LIVE_POLL_QUESTION_MAX_LENGTH },
    status: { type: 'string', enum: ['open', 'closed'] },
    options: {
      type: 'array', minItems: LIVE_POLL_MIN_OPTIONS, maxItems: LIVE_POLL_MAX_OPTIONS,
      items: {
        type: 'object', additionalProperties: false, required: ['label', 'votes'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: LIVE_POLL_OPTION_MAX_LENGTH },
          votes: { type: 'integer', minimum: 0, maximum: LIVE_POLL_MAX_VOTERS },
        },
      },
    },
  }),
} as const;

export function isStreamOverlayKind(value: unknown): value is StreamOverlayKind {
  return STREAM_OVERLAY_KINDS.some((kind) => kind === value);
}

export function isGiftGoalOverlayToken(value: unknown): value is string {
  return typeof value === 'string' && value.length === 66 && tokenPattern.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function count(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function validGiftName(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= giftName.maxLength;
}

export function isGiftGoalOverlaySnapshot(value: unknown): value is GiftGoalOverlaySnapshot {
  const snapshot = record(value);
  return snapshot !== null && (snapshot.giftName === null || validGiftName(snapshot.giftName))
    && count(snapshot.progress, 0) && count(snapshot.targetCount, 1, GIFT_GOAL_MAX_TARGET);
}

export function isLastGiftOverlaySnapshot(value: unknown): value is LastGiftOverlaySnapshot {
  const snapshot = record(value);
  return snapshot !== null && validGiftName(snapshot.giftName) && count(snapshot.quantity, 1, quantity.maximum)
    && count(snapshot.remainingMs, 1, LAST_GIFT_OVERLAY_DURATION_MS);
}

export function isLikeGoalOverlaySnapshot(value: unknown): value is LikeGoalOverlaySnapshot {
  const snapshot = record(value);
  return snapshot !== null && count(snapshot.progress, 0) && count(snapshot.targetCount, 1, LIKE_GOAL_MAX_TARGET);
}

export const isLivePollOverlaySnapshot = isLivePollContent;
