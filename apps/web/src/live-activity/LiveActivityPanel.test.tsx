import type { LiveActivityState } from '@tiktok-helper/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveActivityPanel } from './LiveActivityPanel.js';

const activity: LiveActivityState = {
  workspaceId: 'fixture',
  generation: 1,
  connectionId: '22abacad-9697-4027-b655-8f54674efc59',
  revision: 5,
  viewers: 0,
  totalLikes: 780,
  likeGoal: { targetCount: 100, revision: 1, baselineLikes: 650 },
  recentActions: [{ kind: 'follow', displayName: '<Длинное имя>' }, { kind: 'share', displayName: null }],
};

const renderPanel = (overrides: Partial<React.ComponentProps<typeof LiveActivityPanel>> = {}) => renderToStaticMarkup(
  <LiveActivityPanel state={activity} isCurrent liveOnly={false} onSave={async () => undefined} {...overrides} />,
);

describe('live activity panel', () => {
  it('shows the actual amount above target, caps the bar, and keeps the true zero viewers visible', () => {
    const html = renderPanel();
    expect(html).toContain('<dt>Зрители TikTok</dt><dd>0</dd>');
    expect(html).toContain('<dt>Лайки TikTok</dt><dd>780</dd>');
    expect(html).toContain('130 из 100');
    expect(html).toMatch(/<progress[^>]+value="100"[^>]+max="100"/);
    expect(html).toContain('Цель по лайкам достигнута');
  });

  it('labels stale likes and displays an unknown viewer count while the upstream feed is down', () => {
    const html = renderPanel({ isLive: false });
    expect(html).toContain('<dt>Зрители TikTok</dt><dd aria-label="Нет свежих данных">—</dd>');
    expect(html).toContain('Лайки по последней отметке');
    expect(html).toContain('<dt>Лайки TikTok</dt><dd>780</dd>');
  });

  it('waits for the first room total and keeps controls outside the compact view', () => {
    const html = renderPanel({
      liveOnly: true,
      state: { ...activity, totalLikes: null, likeGoal: { ...activity.likeGoal, baselineLikes: null } },
    });
    expect(html).toContain('Ждём первую отметку лайков');
    expect(html).toContain('До 100 новых лайков');
    expect(html).not.toContain('<progress');
    expect(html).toContain('<div class="live-activity-options" hidden="">');
  });

  it('renders bounded display names as text and distinguishes follows and shares', () => {
    const html = renderPanel();
    expect(html).toContain('Подписался на автора');
    expect(html).toContain('Поделился эфиром');
    expect(html).toContain('<bdi>&lt;Длинное имя&gt;</bdi>');
    expect(html).toContain('<bdi>Зритель</bdi>');
  });
});
