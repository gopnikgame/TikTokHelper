import { workspaceParamsSchema } from './settings.js';

export const REGIONAL_GIFT_REGIONS = ['US', 'CA', 'AE', 'DE', 'BY'] as const;
export type RegionalGiftRegion = (typeof REGIONAL_GIFT_REGIONS)[number];

export interface RegionalGift {
  giftId: string;
  giftName: string;
  imageUrl: string | null;
  diamondCount: number | null;
}

export interface RegionalGiftPage {
  gifts: RegionalGift[];
  hasMore: boolean;
  updatedAt: string | null;
  status: 'ready' | 'empty' | 'rate_limited' | 'unavailable';
  nextRefreshAt: string | null;
  canRefresh: boolean;
}

export const regionalGiftRegionSchema = { type: 'string', enum: REGIONAL_GIFT_REGIONS } as const;
export const regionalGiftParamsSchema = {
  ...workspaceParamsSchema,
  required: ['workspaceId', 'region'],
  properties: { ...workspaceParamsSchema.properties, region: regionalGiftRegionSchema },
} as const;
export const regionalGiftQuerySchema = {
  type: 'object', additionalProperties: false,
  properties: { q: { type: 'string', maxLength: 160 }, page: { type: 'integer', minimum: 1, maximum: 500 } },
} as const;
export const regionalGiftRefreshSchema = {
  type: 'object', additionalProperties: false, required: ['force'],
  properties: { force: { type: 'boolean' } },
} as const;

const nullableDateTime = { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] } as const;
export const regionalGiftPageSchema = {
  type: 'object', additionalProperties: false,
  required: ['gifts', 'hasMore', 'updatedAt', 'status', 'nextRefreshAt', 'canRefresh'],
  properties: {
    gifts: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['giftId', 'giftName', 'imageUrl', 'diamondCount'],
        properties: {
          giftId: { type: 'string' }, giftName: { type: 'string' },
          imageUrl: { anyOf: [{ type: 'string', format: 'uri' }, { type: 'null' }] },
          diamondCount: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
        },
      },
    },
    hasMore: { type: 'boolean' }, updatedAt: nullableDateTime,
    status: { type: 'string', enum: ['ready', 'empty', 'rate_limited', 'unavailable'] },
    nextRefreshAt: nullableDateTime, canRefresh: { type: 'boolean' },
  },
} as const;
