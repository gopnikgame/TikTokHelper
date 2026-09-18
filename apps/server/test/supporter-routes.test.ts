import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

const apps = new Set<ReturnType<typeof buildApp>>();
afterEach(async () => { await Promise.all([...apps].map(async (app) => app.close())); apps.clear(); });

describe('supporter statistics routes', () => {
  it('resets only the requested workspace and invalidates its cached rights', async () => {
    const resetWorkspaceStatistics = vi.fn(async () => 12);
    const onSupporterStatisticsReset = vi.fn();
    const app = buildApp({ logger: false, supporterRepository: { resetWorkspaceStatistics }, onSupporterStatisticsReset });
    apps.add(app);

    const response = await app.inject({ method: 'DELETE', url: '/api/workspaces/primary/supporters/statistics' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deletedSupporters: 12 });
    expect(resetWorkspaceStatistics).toHaveBeenCalledWith('primary');
    expect(onSupporterStatisticsReset).toHaveBeenCalledWith('primary');
  });
});
