import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AutomationConfiguration } from '@tiktok-helper/contracts';
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

const renderEditor = (config: AutomationConfiguration) => renderToStaticMarkup(<AutomationEditor
  workspaceId="primary" configuration={config} sounds={[]} speechSupported={false} speechQueue={null}
  onConfigurationChange={() => undefined} onPreviewSound={() => undefined} onNotice={() => undefined}
/>);

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
    expect(html).toContain('Подарки, звуки, привязки и правила не изменятся');
  });

  it('preserves long user-facing rule names', () => {
    const name = 'Уровень поддержки с очень длинным названием для проверки узкого экрана';
    expect(renderEditor(configuration(name))).toContain(name);
  });
});
