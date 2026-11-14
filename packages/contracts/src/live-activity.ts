export const LIKE_GOAL_MAX_TARGET = 10_000_000;
export const LIVE_ACTIVITY_RECENT_LIMIT = 10;

export interface SaveLikeGoal { targetCount: number | null }

export interface LikeGoalConfiguration extends SaveLikeGoal { revision: number }

export interface LiveSocialAction {
  kind: 'follow' | 'share';
  displayName: string | null;
}

export interface LiveActivityState {
  workspaceId: string;
  generation: number;
  connectionId: string | null;
  revision: number;
  viewers: number | null;
  totalLikes: number | null;
  likeGoal: LikeGoalConfiguration & { baselineLikes: number | null };
  recentActions: LiveSocialAction[];
}

export const saveLikeGoalSchema = {
  type: 'object', additionalProperties: false, required: ['targetCount'],
  properties: { targetCount: { anyOf: [
    { type: 'integer', minimum: 1, maximum: LIKE_GOAL_MAX_TARGET }, { type: 'null' },
  ] } },
} as const;

const workspaceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const connectionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function count(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function isLiveActivityState(value: unknown): value is LiveActivityState {
  const state = object(value);
  if (!state || typeof state.workspaceId !== 'string' || !workspaceIdPattern.test(state.workspaceId)
    || !count(state.generation) || !count(state.revision)
    || (state.connectionId !== null && (typeof state.connectionId !== 'string' || !connectionIdPattern.test(state.connectionId)))
    || (state.viewers !== null && !count(state.viewers)) || (state.totalLikes !== null && !count(state.totalLikes, 1))
    || !Array.isArray(state.recentActions) || state.recentActions.length > LIVE_ACTIVITY_RECENT_LIMIT) return false;
  const goal = object(state.likeGoal);
  if (!goal || !count(goal.revision) || (goal.targetCount !== null && !count(goal.targetCount, 1, LIKE_GOAL_MAX_TARGET))
    || (goal.baselineLikes !== null && (goal.targetCount === null || typeof state.totalLikes !== 'number'
       || !count(goal.baselineLikes, 1, state.totalLikes)))) return false;
  return state.recentActions.every((value: unknown) => {
    const action = object(value);
    return action !== null && (action.kind === 'follow' || action.kind === 'share')
      && Object.keys(action).length === 2
      && (action.displayName === null || (typeof action.displayName === 'string'
        && action.displayName.length > 0 && action.displayName.length <= 120));
  });
}
