export type PlaybackMode = 'controlled_overlap' | 'sequential' | 'strong_overlap';

export interface WorkspaceSettings {
  workspaceId: string;
  tiktokUsername: string;
  playbackMode: PlaybackMode;
  overlapPercent: number;
  maxConcurrentSounds: number;
  volumePercent: number;
  revision: number;
}

export type UpdateWorkspaceSettings = Omit<WorkspaceSettings, 'workspaceId' | 'revision'>;

const settingsProperties = {
  tiktokUsername: { type: 'string', pattern: '^@?[A-Za-z0-9._]{2,24}$' },
  playbackMode: { type: 'string', enum: ['controlled_overlap', 'sequential', 'strong_overlap'] },
  overlapPercent: { type: 'integer', minimum: 0, maximum: 100 },
  maxConcurrentSounds: { type: 'integer', minimum: 1, maximum: 32 },
  volumePercent: { type: 'integer', minimum: 0, maximum: 100 },
} as const;

export const updateWorkspaceSettingsSchema = {
  $id: 'UpdateWorkspaceSettings', type: 'object', additionalProperties: false,
  required: ['tiktokUsername', 'playbackMode', 'overlapPercent', 'maxConcurrentSounds', 'volumePercent'],
  properties: settingsProperties,
} as const;

export const workspaceSettingsSchema = {
  $id: 'WorkspaceSettings', type: 'object', additionalProperties: false,
  required: ['workspaceId', 'revision', ...updateWorkspaceSettingsSchema.required],
  properties: {
    workspaceId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' },
    revision: { type: 'integer', minimum: 1 },
    ...settingsProperties,
  },
} as const;

export const workspaceParamsSchema = {
  $id: 'WorkspaceParams', type: 'object', additionalProperties: false,
  required: ['workspaceId'],
  properties: { workspaceId: workspaceSettingsSchema.properties.workspaceId },
} as const;

export interface WorkspaceParams { workspaceId: string; }

export interface RecentChannel {
  tiktokUsername: string;
  connectionCount: number;
  lastConnectedAt: string;
}

export const recentChannelSchema = {
  type: 'object', additionalProperties: false,
  required: ['tiktokUsername', 'connectionCount', 'lastConnectedAt'],
  properties: {
    tiktokUsername: { type: 'string', pattern: '^@?[A-Za-z0-9._]{2,24}$' },
    connectionCount: { type: 'integer', minimum: 1 },
    lastConnectedAt: { type: 'string', format: 'date-time' },
  },
} as const;
export const recentChannelsSchema = { type: 'array', maxItems: 50, items: recentChannelSchema } as const;
