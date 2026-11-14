export const GIFT_GOAL_MAX_TARGET = 1_000_000;
export const GIFT_GOAL_TOP_LIMIT = 5;

export interface SaveGiftGoal {
  giftId: string;
  targetCount: number;
  soundAssetId: string | null;
  isEnabled: boolean;
}

export interface GiftGoalConfiguration extends SaveGiftGoal {
  revision: number;
}

export interface GiftGoalState {
  workspaceId: string;
  generation: number;
  connectionId: string | null;
  revision: number;
  startedAt: string | null;
  goalStartedAt: string | null;
  configuration: GiftGoalConfiguration | null;
  progress: number;
  lastDonor: { displayName: string; giftId: string; giftName: string; quantity: number } | null;
  topDonors: { displayName: string; points: number }[];
  rankingLimited?: true;
}

export interface GiftGoalUpdate {
  state: GiftGoalState;
  /** Live-only edge. Missing on snapshots and background progress updates. */
  reached?: true;
}

const workspaceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const configurationProperties = {
  giftId: { type: 'string', minLength: 1, maxLength: 80 },
  targetCount: { type: 'integer', minimum: 1, maximum: GIFT_GOAL_MAX_TARGET },
  soundAssetId: { anyOf: [{ type: 'string', pattern: uuidPattern.source }, { type: 'null' }] },
  isEnabled: { type: 'boolean' },
} as const;

export const saveGiftGoalSchema = {
  type: 'object', additionalProperties: false,
  required: Object.keys(configurationProperties), properties: configurationProperties,
} as const;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function nullableTimestamp(value: unknown): boolean {
  return value === null || (text(value, 32) && Number.isFinite(Date.parse(value)));
}

function validConfiguration(value: unknown): boolean {
  const config = object(value);
  return config !== null && text(config.giftId, 80) && integer(config.targetCount, 1, GIFT_GOAL_MAX_TARGET)
    && (config.soundAssetId === null || (typeof config.soundAssetId === 'string' && uuidPattern.test(config.soundAssetId)))
    && typeof config.isEnabled === 'boolean' && integer(config.revision, 1);
}

export function isGiftGoalState(value: unknown): value is GiftGoalState {
  const state = object(value);
  if (!state || typeof state.workspaceId !== 'string' || !workspaceIdPattern.test(state.workspaceId)
    || !integer(state.generation, 0) || !integer(state.revision, 0) || !integer(state.progress, 0)
    || (state.connectionId !== null && (typeof state.connectionId !== 'string' || !uuidPattern.test(state.connectionId)))
    || !nullableTimestamp(state.startedAt) || !nullableTimestamp(state.goalStartedAt)
    || (state.configuration !== null && !validConfiguration(state.configuration))
    || (state.rankingLimited !== undefined && state.rankingLimited !== true)
    || !Array.isArray(state.topDonors) || state.topDonors.length > GIFT_GOAL_TOP_LIMIT) return false;
  const donor = object(state.lastDonor);
  if (state.lastDonor !== null && (!donor || !text(donor.displayName, 120) || !text(donor.giftId, 80)
    || !text(donor.giftName, 160) || !integer(donor.quantity, 1))) return false;
  return state.topDonors.every((value: unknown) => {
    const row = object(value);
    return row !== null && text(row.displayName, 120) && integer(row.points, 1);
  });
}
