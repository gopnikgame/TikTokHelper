import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AutomationConfiguration, EventReaction, ObservedGift } from '@tiktok-helper/contracts';
import { AutomationEditor, AutomationStatus } from './AutomationEditor.js';

const configuration = (name?: string): AutomationConfiguration => ({
  policy: {
    workspaceId: 'primary', moderatorSpeechEnabled: false, moderatorCooldownSeconds: 30,
    defaultSpeechCooldownSeconds: 30, maxMessageCharacters: 200, maxQueueSize: 20,
    readUserName: false, fallbackLanguage: 'ru-RU', revision: 1,
  },
  supportLevels: name ? [{
    id: '123e4567-e89b-42d3-a456-426614174020', workspaceId: 'primary', name,
    thresholdPoints: 10_000, pointsScope: 'lifetime', privilegeDuration: 'permanent',
    privilegeDurationDays: null, grantsChatSpeech: true, chatSpeechCooldownSeconds: 30,
    announcementTemplate: '{user}, поздравляем', soundAssetId: null, isEnabled: true, position: 0,
  }] : [],
  eventReactions: [],
});

const renderEditor = (config: AutomationConfiguration, gifts: ObservedGift[] = [], disabledReason?: string) => renderToStaticMarkup(<AutomationEditor
  workspaceId="primary" configuration={config} sounds={[]} speechSupported={false} speechQueue={null}
  giftReactionCatalog={gifts} giftReactionCheckDisabledReason={disabledReason} onCheckGiftReaction={() => undefined}
  onConfigurationChange={() => undefined} onPreviewSound={() => undefined} onNotice={() => undefined}
/>);

const giftRule: EventReaction = {
  id: '38b2fb16-6c3c-42ae-8b2c-f868730b865a', workspaceId: 'primary', name: 'Любимые розы', eventType: 'gift_completed',
  giftId: '5655', minimumGiftPoints: 20, supportLevelId: null, soundAssetId: null,
  speechTemplate: 'Спасибо, {user}!', cooldownSeconds: 30, isEnabled: false, position: 0,
};

describe('automation editor states', () => {
  it('renders useful loading and recoverable error states', () => {
    expect(renderToStaticMarkup(<AutomationStatus status="loading" />)).toContain('Загружаем правила озвучивания');
    const error = renderToStaticMarkup(<AutomationStatus status="error" onRetry={() => undefined} />);
    expect(error).toContain('Правила озвучивания не загрузились');
    expect(error).toContain('Повторить');
  });

  it('explains empty levels and reactions without internal names', () => {
    const html = renderEditor(configuration());
    expect(html).toContain('Пока нет уровней');
    expect(html).toContain('Реакций пока нет');
    expect(html).not.toContain('moderator_seen');
    expect(html).toContain('Сбросить статистику донатеров');
    expect(html).toContain('Сбрасывает баллы для уровней поддержки и выданные привилегии');
  });

  it('preserves long user-facing rule names', () => {
    const name = 'Уровень поддержки с очень длинным названием для проверки узкого экрана';
    expect(renderEditor(configuration(name))).toContain(name);
  });

  it('shows saved conditions and a test entry for a disabled gift reaction', () => {
    const config = { ...configuration(), eventReactions: [giftRule] };
    const html = renderEditor(config, [{
      giftId: '5655', giftName: 'Rose', imageUrl: null, diamondCount: 1,
      firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z',
    }], 'Проверка доступна после эфира');
    expect(html).toContain('Подарок или завершение серии');
    expect(html).toContain('Rose · ID 5655 · от 20 баллов · пауза 30 сек.');
    expect(html).toContain('Выключена');
    expect(html).toContain('Проверить правило');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Проверка доступна после эфира');
  });

  it('keeps gift rules and their test available with an empty catalog', () => {
    const config = { ...configuration(), eventReactions: [giftRule, {
      ...giftRule, id: '38b2fb16-6c3c-42ae-8b2c-f868730b865b', name: 'Вход модератора', eventType: 'moderator_seen' as const,
    }] };
    const html = renderEditor(config);
    expect(html).toContain('Вход модератора');
    expect(html).toContain('Любимые розы');
    expect(html).toContain('Подарок · ID 5655');
    expect(html).toContain('Проверить правило');
  });
});
