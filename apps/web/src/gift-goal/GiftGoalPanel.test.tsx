import type { GiftGoalState, ObservedGift } from '@tiktok-helper/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GiftGoalPanel } from './GiftGoalPanel.js';

const rose: ObservedGift = {
  giftId: '5655', giftName: 'Роза', imageUrl: null, diamondCount: 1,
  firstSeenAt: '2026-11-14T12:00:00.000Z', lastSeenAt: '2026-11-14T12:00:00.000Z',
};
const activeGoal: GiftGoalState = {
  workspaceId: 'fixture', generation: 1, connectionId: '22abacad-9697-4027-b655-8f54674efc59', revision: 2,
  startedAt: '2026-11-14T12:00:00.000Z', goalStartedAt: '2026-11-14T12:30:00.000Z',
  configuration: { giftId: rose.giftId, targetCount: 3, soundAssetId: null, isEnabled: true, revision: 1 },
  progress: 5,
  lastDonor: { displayName: 'Последний зритель', giftId: '7002', giftName: 'Чай', quantity: 2 },
  topDonors: [{ displayName: 'Лидер эфира', points: 25 }],
};

const renderPanel = (overrides: Partial<React.ComponentProps<typeof GiftGoalPanel>> = {}) => renderToStaticMarkup(<GiftGoalPanel
  state={activeGoal} isCurrent liveOnly={false} gifts={[rose]} sounds={[]} onSave={async () => undefined} {...overrides}
/>);

describe('gift goal panel', () => {
  it('shows an overshoot as the actual count and caps visual progress', () => {
    const html = renderPanel();
    expect(html).toContain('Роза');
    expect(html).toContain('5 из 3');
    expect(html).toMatch(/<progress[^>]+value="3"[^>]+max="3"/);
    expect(html).toContain('Цель достигнута');
    expect(html).toContain('Цель с <time dateTime="2026-11-14T12:30:00.000Z"');
    expect(html).toContain('Последний зритель');
    expect(html).toContain('Чай');
    expect(html).toContain('Лидер эфира');
  });

  it('keeps statistics visible and settings hidden in the live-only view', () => {
    const html = renderPanel({ liveOnly: true });
    expect(html).toContain('data-compact="true"');
    expect(html).toContain('<details class="gift-goal-settings" hidden="">');
    expect(html).toContain('Топ дарителей');
    expect(html).toContain('5 из 3');
  });

  it('offers recovery when the current snapshot is unavailable', () => {
    const html = renderPanel({ state: null, isCurrent: false, error: true, onRetry: () => undefined });
    expect(html).toContain('Не удалось обновить статистику');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('Сохранить цель');
  });
});
