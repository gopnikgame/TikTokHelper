import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AutomationConfiguration, EventReaction, SaveEventReaction, SaveSupportLevel,
  SupportLevel, UpdateWorkspaceSpeechPolicy, WorkspaceSpeechPolicy,
} from '@tiktok-helper/contracts';

import { buildApp } from '../src/app.js';
import type { AutomationRepository } from '../src/automation/repository.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

const configurations = new Map<string, AutomationConfiguration>();
const defaults = (workspaceId: string): AutomationConfiguration => ({
  policy: {
    workspaceId, moderatorSpeechEnabled: false, moderatorCooldownSeconds: 30,
    defaultSpeechCooldownSeconds: 30, maxMessageCharacters: 200, maxQueueSize: 20,
    readUserName: false, fallbackLanguage: 'ru-RU', revision: 1,
  },
  supportLevels: [], eventReactions: [],
});
const config = (workspaceId: string) => configurations.get(workspaceId) ?? defaults(workspaceId);

const repository: AutomationRepository = {
  async get(workspaceId) { return config(workspaceId); },
  async savePolicy(workspaceId, input: UpdateWorkspaceSpeechPolicy): Promise<WorkspaceSpeechPolicy> {
    const current = config(workspaceId);
    const policy = { workspaceId, ...input, revision: current.policy.revision + 1 };
    configurations.set(workspaceId, { ...current, policy }); return policy;
  },
  async createSupportLevel(workspaceId, input: SaveSupportLevel): Promise<SupportLevel> {
    const current = config(workspaceId); const level = { id: randomUUID(), workspaceId, ...input };
    configurations.set(workspaceId, { ...current, supportLevels: [...current.supportLevels, level] }); return level;
  },
  async updateSupportLevel(workspaceId, id, input) {
    const current = config(workspaceId); const found = current.supportLevels.some((item) => item.id === id);
    if (!found) return null;
    const level = { id, workspaceId, ...input };
    configurations.set(workspaceId, { ...current, supportLevels: current.supportLevels.map((item) => item.id === id ? level : item) });
    return level;
  },
  async deleteSupportLevel(workspaceId, id) {
    const current = config(workspaceId); const next = current.supportLevels.filter((item) => item.id !== id);
    if (next.length === current.supportLevels.length) return false;
    configurations.set(workspaceId, { ...current, supportLevels: next }); return true;
  },
  async createEventReaction(workspaceId, input: SaveEventReaction): Promise<EventReaction> {
    const current = config(workspaceId); const reaction = { id: randomUUID(), workspaceId, ...input };
    configurations.set(workspaceId, { ...current, eventReactions: [...current.eventReactions, reaction] }); return reaction;
  },
  async updateEventReaction(workspaceId, id, input) {
    const current = config(workspaceId); const found = current.eventReactions.some((item) => item.id === id);
    if (!found) return null;
    const reaction = { id, workspaceId, ...input };
    configurations.set(workspaceId, { ...current, eventReactions: current.eventReactions.map((item) => item.id === id ? reaction : item) });
    return reaction;
  },
  async deleteEventReaction(workspaceId, id) {
    const current = config(workspaceId); const next = current.eventReactions.filter((item) => item.id !== id);
    if (next.length === current.eventReactions.length) return false;
    configurations.set(workspaceId, { ...current, eventReactions: next }); return true;
  },
};

const levelPayload = {
  name: 'Голос эфира', thresholdPoints: 10_000, pointsScope: 'lifetime',
  privilegeDuration: 'permanent', privilegeDurationDays: null, grantsChatSpeech: true,
  chatSpeechCooldownSeconds: 30, announcementTemplate: '{user}, ваши сообщения теперь звучат',
  soundAssetId: null, isEnabled: false, position: 0,
} as const;

describe('workspace automation API', () => {
  it('starts silent and round-trips workspace-scoped support levels', async () => {
    configurations.clear(); const app = buildApp({ logger: false, automationRepository: repository }); apps.add(app);
    const initial = await app.inject({ method: 'GET', url: '/api/workspaces/primary/automation' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ policy: { moderatorSpeechEnabled: false }, supportLevels: [], eventReactions: [] });

    const created = await app.inject({ method: 'POST', url: '/api/workspaces/primary/automation/support-levels', payload: levelPayload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ workspaceId: 'primary', isEnabled: false, soundAssetId: null });
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/other/automation' })).json())
      .toMatchObject({ supportLevels: [] });
  });

  it('rejects unsafe templates and inconsistent durations before the repository', async () => {
    const app = buildApp({ logger: false, automationRepository: repository }); apps.add(app);
    expect((await app.inject({
      method: 'POST', url: '/api/workspaces/primary/automation/support-levels',
      payload: { ...levelPayload, announcementTemplate: '{constructor}' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/api/workspaces/primary/automation/support-levels',
      payload: { ...levelPayload, privilegeDuration: 'days', privilegeDurationDays: null },
    })).statusCode).toBe(400);
  });

  it('stores event reactions disabled by default and without an implicit action', async () => {
    configurations.clear(); const app = buildApp({ logger: false, automationRepository: repository }); apps.add(app);
    const response = await app.inject({
      method: 'POST', url: '/api/workspaces/primary/automation/event-reactions', payload: {
        name: 'Модератор появился', eventType: 'moderator_seen', supportLevelId: null,
        speechTemplate: null, soundAssetId: null, cooldownSeconds: 300, isEnabled: false, position: 0,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ isEnabled: false, speechTemplate: null, soundAssetId: null });
  });

  it('updates policy and supports editing and deleting only items in the requested workspace', async () => {
    configurations.clear(); const app = buildApp({ logger: false, automationRepository: repository }); apps.add(app);
    const policy = await app.inject({ method: 'PUT', url: '/api/workspaces/primary/automation/policy', payload: {
      moderatorSpeechEnabled: true, moderatorCooldownSeconds: 20,
      defaultSpeechCooldownSeconds: 30, maxMessageCharacters: 180, maxQueueSize: 10,
      readUserName: true, fallbackLanguage: 'ru-RU',
    } });
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({ moderatorSpeechEnabled: true, revision: 2 });

    const created = await app.inject({ method: 'POST', url: '/api/workspaces/primary/automation/support-levels', payload: levelPayload });
    const id = created.json<{ id: string }>().id;
    expect((await app.inject({
      method: 'PUT', url: `/api/workspaces/other/automation/support-levels/${id}`,
      payload: { ...levelPayload, name: 'Чужое изменение' },
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'PUT', url: `/api/workspaces/primary/automation/support-levels/${id}`,
      payload: { ...levelPayload, name: 'Новый уровень', isEnabled: true },
    })).json()).toMatchObject({ name: 'Новый уровень', isEnabled: true });
    expect((await app.inject({ method: 'DELETE', url: `/api/workspaces/primary/automation/support-levels/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/workspaces/primary/automation/support-levels/${id}` })).statusCode).toBe(404);
  });
});
