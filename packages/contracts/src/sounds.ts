export interface SoundAsset {
  id: string;
  displayName: string;
  url: string;
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
  type: 'object', additionalProperties: false, required: ['id', 'displayName', 'url'],
  properties: { id: uuid, displayName: { type: 'string' }, url: { type: 'string' } },
} as const;
export const soundAssetsSchema = { type: 'array', items: soundAssetSchema } as const;
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
