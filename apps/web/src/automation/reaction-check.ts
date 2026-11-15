import type { AutomationConfiguration, GiftSoundMapping, ObservedGift, SoundAsset } from '@tiktok-helper/contracts';
import type { PlaybackSettings } from '../audio/playback.js';
import { evaluateGiftReaction, findGiftReaction, giftTotalPoints, SpeechPolicyEngine, type GiftReactionInput, type SpeechJob } from '../speech/policy.js';

export type ReactionCheckAction =
  | { type: 'sound'; asset: SoundAsset; count: number }
  | { type: 'speech'; job: SpeechJob }
  | { type: 'skipped'; label: string; reason: string };

export function validPlaybackSettings(settings: PlaybackSettings): boolean {
  return Number.isInteger(settings.maxConcurrentSounds) && settings.maxConcurrentSounds >= 1 && settings.maxConcurrentSounds <= 32
    && Number.isInteger(settings.overlapPercent) && settings.overlapPercent >= 0 && settings.overlapPercent <= 100
    && Number.isInteger(settings.volumePercent) && settings.volumePercent >= 0 && settings.volumePercent <= 100;
}

function soundAction(
  name: string, sound: SoundAsset | undefined, count: number, volumePercent: number,
): ReactionCheckAction {
  if (sound?.status !== 'active') {
    return { type: 'skipped', label: name, reason: 'Звук недоступен. Выберите другой в настройках.' };
  }
  if (volumePercent === 0) {
    return { type: 'skipped', label: name, reason: 'Поднимите громкость в настройках звука.' };
  }
  return { type: 'sound', asset: sound, count };
}

export function giftCheckActions(
  mapping: GiftSoundMapping | undefined,
  sounds: ReadonlyMap<string, SoundAsset>,
  count: number,
  volumePercent: number,
): ReactionCheckAction[] {
  if (!mapping) {
    return [{ type: 'skipped', label: 'Звук подарка', reason: 'Выберите звук и сохраните привязку в пульте.' }];
  }
  if (!mapping.isEnabled) {
    return [{ type: 'skipped', label: mapping.soundDisplayName, reason: 'Привязка выключена.' }];
  }
  return [soundAction(mapping.soundDisplayName, sounds.get(mapping.soundAssetId), count, volumePercent)];
}

export type GiftCheckSampleGift = Pick<ObservedGift, 'giftId' | 'giftName' | 'diamondCount'>;

interface GiftCompletionSample {
  gift: GiftCheckSampleGift;
  count: number;
  ruleId: string;
  withinCooldown: boolean;
  soundVolume: number;
  voiceVolume: number | undefined;
}

export function giftCompletionCheckActions(
  configuration: AutomationConfiguration | null,
  sounds: ReadonlyMap<string, SoundAsset>,
  sample: GiftCompletionSample,
): ReactionCheckAction[] {
  const skip = (label: string, reason: string): ReactionCheckAction[] => [{ type: 'skipped', label, reason }];
  if (!configuration) return skip('Реакция', 'Загрузите настройки озвучивания.');

  const gift: GiftReactionInput = {
    eventId: 'preview:gift-completed',
    giftId: sample.gift.giftId, giftName: sample.gift.giftName,
    senderDisplayName: 'Тестовый зритель', senderUsername: 'test_viewer',
    repeatCount: sample.count, diamondCount: sample.gift.diamondCount ?? undefined,
  };
  const soundAvailable = (id: string) => sounds.get(id)?.status === 'active';
  // Start with a fresh cooldown, or simulate that the selected rule just ran.
  const lastRunFor = (id: string) => sample.withinCooldown && id === sample.ruleId ? 0 : undefined;
  const match = findGiftReaction(gift, configuration, soundAvailable, 0, lastRunFor);

  if (sample.ruleId) {
    const selected = configuration.eventReactions.find((rule) => rule.id === sample.ruleId && rule.eventType === 'gift_completed');
    if (!selected) return skip('Реакция', 'Выберите сохранённое правило.');
    const decision = evaluateGiftReaction(selected, gift, configuration, soundAvailable, 0, lastRunFor(selected.id));
    if (decision.status !== 'ready') {
      const reasons: Record<typeof decision.status, string> = {
        disabled: 'Правило выключено.',
        gift_mismatch: 'Правило настроено на другой подарок.',
        unknown_value: 'Стоимость этого подарка пока неизвестна.',
        below_minimum: `${giftTotalPoints(gift)?.toLocaleString('ru-RU')} баллов из ${selected.minimumGiftPoints?.toLocaleString('ru-RU')} необходимых.`,
        unavailable: 'Добавьте фразу или выберите доступный звук.',
        cooldown: `Между срабатываниями должна пройти пауза ${selected.cooldownSeconds} с.`,
      };
      return skip(selected.name, reasons[decision.status]);
    }
    if (match && match.rule.id !== selected.id) return skip(selected.name, `Раньше в списке подходит правило «${match.rule.name}».`);
  }
  if (!match) return skip('Реакция', 'Для этого подарка и стоимости нет подходящего включённого правила.');

  const actions: ReactionCheckAction[] = [];
  if (match.rule.soundAssetId) {
    actions.push(soundAction(`${match.rule.name} · Звук`, sounds.get(match.rule.soundAssetId), 1, sample.soundVolume));
  }
  if (match.reaction.speech) {
    if (!sample.voiceVolume) {
      actions.push({
        type: 'skipped', label: 'Благодарность',
        reason: sample.voiceVolume === undefined ? 'Этот браузер не поддерживает озвучивание.' : 'Поднимите громкость в настройках голоса.',
      });
    } else {
      actions.push({ type: 'speech', job: match.reaction.speech });
    }
  }
  return actions;
}

export function donorCheckActions(
  configuration: AutomationConfiguration | null,
  repeat: boolean,
  sounds: ReadonlyMap<string, SoundAsset>,
  soundVolume: number,
  voiceVolume: number | undefined,
): ReactionCheckAction[] {
  if (!configuration) {
    return [{ type: 'skipped', label: 'Реакция', reason: 'Загрузите настройки в разделе «Озвучивание чата и реакции».' }];
  }
  const engine = new SpeechPolicyEngine();
  const participant = { eventId: 'test-donor', senderUsername: 'test_viewer', senderDisplayName: 'Тестовый зритель' };
  const firstReaction = engine.evaluateParticipantSeen('donor_seen', participant, configuration);
  if (!firstReaction.speech && !firstReaction.soundAssetIds.length) {
    return [{ type: 'skipped', label: 'Реакция', reason: 'Назначьте звук или фразу на событие «Появился даритель».' }];
  }
  const reaction = repeat
    ? engine.evaluateParticipantSeen('donor_seen', { ...participant, eventId: 'test-donor-again' }, configuration)
    : firstReaction;
  if (!reaction.speech && !reaction.soundAssetIds.length) {
    return [{ type: 'skipped', label: 'Реакция', reason: 'Правило срабатывает при первом появлении этого зрителя.' }];
  }

  const actions = reaction.soundAssetIds.map((id) => {
    const sound = sounds.get(id);
    return soundAction(sound?.displayName ?? 'Звук реакции', sound, 1, soundVolume);
  });
  if (reaction.speech) {
    if (voiceVolume === undefined || voiceVolume === 0) {
      actions.push({
        type: 'skipped', label: 'Озвучка',
        reason: voiceVolume === undefined ? 'Этот браузер не поддерживает озвучивание.' : 'Поднимите громкость в настройках голоса.',
      });
    } else {
      actions.push({ type: 'speech', job: reaction.speech });
    }
  }
  return actions;
}
