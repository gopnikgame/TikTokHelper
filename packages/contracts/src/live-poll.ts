import { workspaceParamsSchema } from './settings.js';

export const LIVE_POLL_QUESTION_MAX_LENGTH = 160;
export const LIVE_POLL_OPTION_MAX_LENGTH = 80;
export const LIVE_POLL_MIN_OPTIONS = 2;
export const LIVE_POLL_MAX_OPTIONS = 4;
export const LIVE_POLL_MAX_VOTERS = 50_000;

export interface StartLivePoll {
  connectionId: string;
  previousPollId: string | null;
  question: string;
  options: string[];
}

export interface CloseLivePoll { status: 'closed' }

export interface LivePollContent {
  question: string;
  options: { label: string; votes: number }[];
  status: 'open' | 'closed';
}

export interface LivePoll extends LivePollContent { id: string }

export interface LivePollState {
  workspaceId: string;
  generation: number;
  connectionId: string | null;
  revision: number;
  poll: LivePoll | null;
}

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const uuid = new RegExp(uuidPattern);
const uuidSchema = { type: 'string', pattern: uuidPattern } as const;
const optionLabelSchema = { type: 'string', minLength: 1, maxLength: LIVE_POLL_OPTION_MAX_LENGTH } as const;
const workspaceId = new RegExp(workspaceParamsSchema.properties.workspaceId.pattern);

export const startLivePollSchema = {
  type: 'object', additionalProperties: false,
  required: ['connectionId', 'previousPollId', 'question', 'options'],
  properties: {
    connectionId: uuidSchema,
    previousPollId: { anyOf: [uuidSchema, { type: 'null' }] },
    question: { type: 'string', minLength: 1, maxLength: LIVE_POLL_QUESTION_MAX_LENGTH },
    options: { type: 'array', minItems: LIVE_POLL_MIN_OPTIONS, maxItems: LIVE_POLL_MAX_OPTIONS, items: optionLabelSchema },
  },
} as const;

export const closeLivePollSchema = {
  type: 'object', additionalProperties: false, required: ['status'],
  properties: { status: { type: 'string', const: 'closed' } },
} as const;

export const livePollParamsSchema = {
  type: 'object', additionalProperties: false, required: ['workspaceId', 'pollId'],
  properties: { ...workspaceParamsSchema.properties, pollId: uuidSchema },
} as const;

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

function count(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function trimmedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function isOptionList(values: unknown): values is unknown[] {
  return Array.isArray(values) && values.length >= LIVE_POLL_MIN_OPTIONS && values.length <= LIVE_POLL_MAX_OPTIONS;
}

export function parseStartLivePoll(value: unknown): StartLivePoll | undefined {
  const input = record(value);
  if (!input || Object.keys(input).length !== 4) return undefined;
  const { connectionId, previousPollId, options } = input;
  const question = trimmedText(input.question, LIVE_POLL_QUESTION_MAX_LENGTH);
  if (!isUuid(connectionId) || (previousPollId !== null && !isUuid(previousPollId)) || !question || !isOptionList(options)) return undefined;
  const labels: string[] = [];
  const comparableLabels = new Set<string>();
  for (const value of options) {
    const label = trimmedText(value, LIVE_POLL_OPTION_MAX_LENGTH);
    if (!label) return undefined;
    const comparable = label.normalize('NFC').toLowerCase();
    if (comparableLabels.has(comparable)) return undefined;
    labels.push(label);
    comparableLabels.add(comparable);
  }
  return { connectionId, previousPollId, question, options: labels };
}

export function isLivePollContent(value: unknown): value is LivePollContent {
  const poll = record(value);
  if (!poll || (poll.status !== 'open' && poll.status !== 'closed')
    || !trimmedText(poll.question, LIVE_POLL_QUESTION_MAX_LENGTH) || !isOptionList(poll.options)) return false;
  let total = 0;
  for (const value of poll.options) {
    const option = record(value);
    if (!option || !trimmedText(option.label, LIVE_POLL_OPTION_MAX_LENGTH) || !count(option.votes, LIVE_POLL_MAX_VOTERS)) return false;
    total += option.votes;
  }
  return total <= LIVE_POLL_MAX_VOTERS;
}

export function isLivePollState(value: unknown): value is LivePollState {
  const state = record(value);
  if (!state || typeof state.workspaceId !== 'string' || !workspaceId.test(state.workspaceId) || !count(state.generation)
    || !count(state.revision) || (state.connectionId !== null && !isUuid(state.connectionId))) return false;
  return state.poll === null || (!!state.connectionId && isUuid(record(state.poll)?.id) && isLivePollContent(state.poll));
}
