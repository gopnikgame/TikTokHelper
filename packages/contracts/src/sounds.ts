export interface SoundAsset {
  id: string;
  displayName: string;
  url: string;
  status: 'active' | 'quarantined';
  createdByUserId: string | null;
  isOwnedByCurrentUser: boolean;
  usageCount: number;
  quarantineReason: string | null;
  canQuarantine: boolean;
  canDelete: boolean;
}

export interface QuarantineSoundInput { reason: string }

export interface UploadSoundQuery {
  displayName: string;
}

export interface ObservedGift {
  giftId: string;
  giftName: string;
  imageUrl: string | null;
  diamondCount: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface GiftSoundMapping {
  giftId: string;
  soundAssetId: string;
  soundDisplayName: string;
  soundUrl: string;
  isEnabled: boolean;
}

export interface UpdateGiftSoundMapping {
  giftId: string;
  soundAssetId: string;
  isEnabled: boolean;
}

const uuid = { type: 'string', format: 'uuid' } as const;
export const soundAssetSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'displayName', 'url', 'status', 'createdByUserId', 'isOwnedByCurrentUser', 'usageCount', 'quarantineReason', 'canQuarantine', 'canDelete'],
  properties: {
    id: uuid, displayName: { type: 'string' }, url: { type: 'string' },
    status: { type: 'string', enum: ['active', 'quarantined'] },
    createdByUserId: { anyOf: [uuid, { type: 'null' }] },
    isOwnedByCurrentUser: { type: 'boolean' }, usageCount: { type: 'integer', minimum: 0 },
    quarantineReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    canQuarantine: { type: 'boolean' }, canDelete: { type: 'boolean' },
  },
} as const;
export const soundAssetsSchema = { type: 'array', items: soundAssetSchema } as const;
export const soundParamsSchema = {
  type: 'object', additionalProperties: false, required: ['workspaceId', 'soundId'],
  properties: {
    workspaceId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' },
    soundId: uuid,
  },
} as const;
export const quarantineSoundInputSchema = {
  type: 'object', additionalProperties: false, required: ['reason'],
  properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } },
} as const;
export const uploadSoundQuerySchema = {
  type: 'object', additionalProperties: false, required: ['displayName'],
  properties: { displayName: { type: 'string', minLength: 1, maxLength: 160 } },
} as const;
export const observedGiftSchema = {
  type: 'object', additionalProperties: false,
  required: ['giftId', 'giftName', 'imageUrl', 'diamondCount', 'firstSeenAt', 'lastSeenAt'],
  properties: {
    giftId: { type: 'string' }, giftName: { type: 'string' },
    imageUrl: { anyOf: [{ type: 'string', format: 'uri' }, { type: 'null' }] },
    diamondCount: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    firstSeenAt: { type: 'string', format: 'date-time' }, lastSeenAt: { type: 'string', format: 'date-time' },
  },
} as const;
export const observedGiftsSchema = { type: 'array', items: observedGiftSchema } as const;
export const giftSoundMappingSchema = {
  type: 'object', additionalProperties: false,
  required: ['giftId', 'soundAssetId', 'soundDisplayName', 'soundUrl', 'isEnabled'],
  properties: {
    giftId: { type: 'string' }, soundAssetId: uuid, soundDisplayName: { type: 'string' },
    soundUrl: { type: 'string' }, isEnabled: { type: 'boolean' },
  },
} as const;
export const giftSoundMappingsSchema = { type: 'array', items: giftSoundMappingSchema } as const;
export const updateGiftSoundMappingSchema = {
  type: 'object', additionalProperties: false, required: ['giftId', 'soundAssetId', 'isEnabled'],
  properties: {
    giftId: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[^/\\\\]+$' },
    soundAssetId: uuid, isEnabled: { type: 'boolean' },
  },
} as const;
