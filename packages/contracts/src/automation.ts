export const TEMPLATE_VARIABLES = [
  'user', 'username', 'message', 'gift', 'count', 'points', 'total',
  'level', 'threshold', 'language',
] as const;

export type TemplateVariable = typeof TEMPLATE_VARIABLES[number];
export type SupportPointsScope = 'stream' | 'lifetime';
export type PrivilegeDuration = 'stream' | 'days' | 'permanent';
export type ReactionEventType = 'moderator_seen' | 'donor_seen' | 'support_level_reached';

export interface WorkspaceSpeechPolicy {
  workspaceId: string;
  moderatorSpeechEnabled: boolean;
  moderatorCooldownSeconds: number;
  defaultSpeechCooldownSeconds: number;
  maxMessageCharacters: number;
  maxQueueSize: number;
  readUserName: boolean;
  fallbackLanguage: string;
  revision: number;
}

export type UpdateWorkspaceSpeechPolicy = Omit<WorkspaceSpeechPolicy, 'workspaceId' | 'revision'>;

export interface SupportLevel {
  id: string;
  workspaceId: string;
  name: string;
  thresholdPoints: number;
  pointsScope: SupportPointsScope;
  privilegeDuration: PrivilegeDuration;
  privilegeDurationDays: number | null;
  grantsChatSpeech: boolean;
  chatSpeechCooldownSeconds: number;
  announcementTemplate: string | null;
  soundAssetId: string | null;
  isEnabled: boolean;
  position: number;
}

export type SaveSupportLevel = Omit<SupportLevel, 'id' | 'workspaceId'>;

export interface EventReaction {
  id: string;
  workspaceId: string;
  name: string;
  eventType: ReactionEventType;
  supportLevelId: string | null;
  speechTemplate: string | null;
  soundAssetId: string | null;
  cooldownSeconds: number;
  isEnabled: boolean;
  position: number;
}

export type SaveEventReaction = Omit<EventReaction, 'id' | 'workspaceId'>;

export interface AutomationConfiguration {
  policy: WorkspaceSpeechPolicy;
  supportLevels: SupportLevel[];
  eventReactions: EventReaction[];
}

const uuid = { type: 'string', format: 'uuid' } as const;
const nullableUuid = { anyOf: [uuid, { type: 'null' }] } as const;
const workspaceId = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' } as const;
const templatePattern = '^(?:[^{}]|\\{(?:user|username|message|gift|count|points|total|level|threshold|language)\\})*$';
const nullableTemplate = {
  anyOf: [
    { type: 'string', minLength: 1, maxLength: 500, pattern: templatePattern },
    { type: 'null' },
  ],
} as const;

const speechPolicyProperties = {
  moderatorSpeechEnabled: { type: 'boolean' },
  moderatorCooldownSeconds: { type: 'integer', minimum: 5, maximum: 3600 },
  defaultSpeechCooldownSeconds: { type: 'integer', minimum: 5, maximum: 3600 },
  maxMessageCharacters: { type: 'integer', minimum: 20, maximum: 500 },
  maxQueueSize: { type: 'integer', minimum: 1, maximum: 100 },
  readUserName: { type: 'boolean' },
  fallbackLanguage: { type: 'string', minLength: 2, maxLength: 16, pattern: '^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$' },
} as const;

export const updateWorkspaceSpeechPolicySchema = {
  type: 'object', additionalProperties: false,
  required: Object.keys(speechPolicyProperties), properties: speechPolicyProperties,
} as const;

export const workspaceSpeechPolicySchema = {
  type: 'object', additionalProperties: false,
  required: ['workspaceId', 'revision', ...Object.keys(speechPolicyProperties)],
  properties: {
    workspaceId, revision: { type: 'integer', minimum: 1 }, ...speechPolicyProperties,
  },
} as const;

const supportLevelProperties = {
  name: { type: 'string', minLength: 1, maxLength: 80 },
  thresholdPoints: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
  pointsScope: { type: 'string', enum: ['stream', 'lifetime'] },
  privilegeDuration: { type: 'string', enum: ['stream', 'days', 'permanent'] },
  privilegeDurationDays: { anyOf: [{ type: 'integer', minimum: 1, maximum: 3650 }, { type: 'null' }] },
  grantsChatSpeech: { type: 'boolean' },
  chatSpeechCooldownSeconds: { type: 'integer', minimum: 5, maximum: 3600 },
  announcementTemplate: nullableTemplate,
  soundAssetId: nullableUuid,
  isEnabled: { type: 'boolean' },
  position: { type: 'integer', minimum: 0, maximum: 10_000 },
} as const;

export const saveSupportLevelSchema = {
  type: 'object', additionalProperties: false,
  required: Object.keys(supportLevelProperties), properties: supportLevelProperties,
  allOf: [
    {
      if: { properties: { privilegeDuration: { const: 'days' } } },
      then: { properties: { privilegeDurationDays: { type: 'integer', minimum: 1, maximum: 3650 } } },
    },
    {
      if: { properties: { privilegeDuration: { enum: ['stream', 'permanent'] } } },
      then: { properties: { privilegeDurationDays: { type: 'null' } } },
    },
  ],
} as const;

export const supportLevelSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'workspaceId', ...Object.keys(supportLevelProperties)],
  properties: { id: uuid, workspaceId, ...supportLevelProperties },
} as const;

export const supportLevelsSchema = { type: 'array', maxItems: 100, items: supportLevelSchema } as const;

const eventReactionProperties = {
  name: { type: 'string', minLength: 1, maxLength: 80 },
  eventType: { type: 'string', enum: ['moderator_seen', 'donor_seen', 'support_level_reached'] },
  supportLevelId: nullableUuid,
  speechTemplate: nullableTemplate,
  soundAssetId: nullableUuid,
  cooldownSeconds: { type: 'integer', minimum: 0, maximum: 86_400 },
  isEnabled: { type: 'boolean' },
  position: { type: 'integer', minimum: 0, maximum: 10_000 },
} as const;

export const saveEventReactionSchema = {
  type: 'object', additionalProperties: false,
  required: Object.keys(eventReactionProperties), properties: eventReactionProperties,
} as const;

export const eventReactionSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'workspaceId', ...Object.keys(eventReactionProperties)],
  properties: { id: uuid, workspaceId, ...eventReactionProperties },
} as const;

export const eventReactionsSchema = { type: 'array', maxItems: 100, items: eventReactionSchema } as const;

export const automationConfigurationSchema = {
  type: 'object', additionalProperties: false,
  required: ['policy', 'supportLevels', 'eventReactions'],
  properties: {
    policy: workspaceSpeechPolicySchema,
    supportLevels: supportLevelsSchema,
    eventReactions: eventReactionsSchema,
  },
} as const;

export const automationItemParamsSchema = {
  type: 'object', additionalProperties: false, required: ['workspaceId', 'itemId'],
  properties: { workspaceId, itemId: uuid },
} as const;

export interface AutomationItemParams { workspaceId: string; itemId: string }

export function templateVariables(template: string): string[] {
  return [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1] ?? '');
}

export function hasOnlyKnownTemplateVariables(template: string): boolean {
  const known = new Set<string>(TEMPLATE_VARIABLES);
  if (template.length > 500) return false;

  let hasUnknownVariable = false;
  const remainder = template.replace(/\{([^{}]+)\}/g, (_match, variable: string) => {
    if (!known.has(variable)) hasUnknownVariable = true;
    return '';
  });

  return !hasUnknownVariable && !/[{}]/.test(remainder);
}
