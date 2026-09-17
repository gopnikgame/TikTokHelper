import type {
  AutomationConfiguration, ChatEvent, GiftEvent, ReactionEventType, SupportLevelGrantedEvent, TemplateVariable,
} from '@tiktok-helper/contracts';

export interface SpeechJob {
  id: string;
  text: string;
  language: string;
  priority: 'normal' | 'moderator';
}

export interface GrantReaction {
  speech: SpeechJob | null;
  soundAssetIds: string[];
}

const MAX_DEDUPLICATION_IDS = 2_000;

export function renderTemplate(template: string, variables: Partial<Record<TemplateVariable, string | number>>): string {
  return template.replace(/\{([^{}]+)\}/g, (token, name: string) => {
    const value = variables[name as TemplateVariable];
    return value === undefined ? token : String(value);
  });
}

export class SpeechPolicyEngine {
  readonly #seen = new Set<string>();
  readonly #seenParticipants = new Set<string>();
  readonly #lastSpokenByUser = new Map<string, number>();
  readonly #lastReactionAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  evaluateChat(event: ChatEvent, configuration: AutomationConfiguration): SpeechJob | null {
    if (this.#seen.has(event.eventId)) return null;
    this.#remember(event.eventId);
    const context = event.speakerContext;
    if (!context) return null;

    const moderator = context.isModerator && configuration.policy.moderatorSpeechEnabled;
    const enabledLevels = new Map(configuration.supportLevels
      .filter((level) => level.isEnabled && level.grantsChatSpeech)
      .map((level) => [level.id, level]));
    const entitlement = context.speechLevels
      .map((item) => ({ entitlement: item, level: enabledLevels.get(item.levelId) }))
      .filter((item): item is { entitlement: typeof item.entitlement; level: NonNullable<typeof item.level> } => item.level !== undefined)
      .sort((left, right) => left.level.position - right.level.position)[0];
    if (!moderator && !entitlement) return null;

    const cooldownSeconds = moderator
      ? configuration.policy.moderatorCooldownSeconds
      : (entitlement?.entitlement.cooldownSeconds ?? configuration.policy.defaultSpeechCooldownSeconds);
    const userKey = event.senderUsername.toLocaleLowerCase();
    const now = this.now();
    if (now - (this.#lastSpokenByUser.get(userKey) ?? Number.NEGATIVE_INFINITY) < cooldownSeconds * 1_000) return null;
    this.#lastSpokenByUser.set(userKey, now);

    const message = [...event.text.trim()].slice(0, configuration.policy.maxMessageCharacters).join('');
    if (!message) return null;
    const text = configuration.policy.readUserName ? `${event.senderDisplayName}: ${message}` : message;
    return {
      id: event.eventId, text,
      language: event.language ?? configuration.policy.fallbackLanguage,
      priority: moderator ? 'moderator' : 'normal',
    };
  }

  evaluateGrant(event: SupportLevelGrantedEvent, configuration: AutomationConfiguration): GrantReaction {
    if (this.#seen.has(event.eventId)) return { speech: null, soundAssetIds: [] };
    this.#remember(event.eventId);
    const level = configuration.supportLevels.find((item) => item.id === event.levelId && item.isEnabled);
    if (!level) return { speech: null, soundAssetIds: [] };
    const reactions = configuration.eventReactions.filter((item) => item.isEnabled
      && item.eventType === 'support_level_reached'
      && (item.supportLevelId === null || item.supportLevelId === event.levelId));
    const variables = {
      user: event.senderDisplayName, username: event.senderUsername,
      points: event.pointsAdded, total: event.lifetimeTotal,
      level: event.levelName, threshold: event.thresholdPoints,
    } satisfies Partial<Record<TemplateVariable, string | number>>;
    const template = level.announcementTemplate ?? reactions.find((item) => item.speechTemplate)?.speechTemplate ?? null;
    return {
      speech: template ? {
        id: event.eventId, text: renderTemplate(template, variables),
        language: configuration.policy.fallbackLanguage, priority: 'normal',
      } : null,
      soundAssetIds: [...new Set([
        ...(level.soundAssetId ? [level.soundAssetId] : []),
        ...reactions.flatMap((item) => item.soundAssetId ? [item.soundAssetId] : []),
      ])],
    };
  }

  evaluateParticipantSeen(
    eventType: Extract<ReactionEventType, 'moderator_seen' | 'donor_seen'>,
    participant: Pick<ChatEvent | GiftEvent, 'eventId' | 'senderDisplayName' | 'senderUsername'> & { language?: string },
    configuration: AutomationConfiguration,
  ): GrantReaction {
    const participantKey = `${eventType}:${participant.senderUsername.toLocaleLowerCase()}`;
    if (this.#seenParticipants.has(participantKey)) return { speech: null, soundAssetIds: [] };
    this.#seenParticipants.add(participantKey);
    const now = this.now();
    const reactions = configuration.eventReactions.filter((reaction) => {
      if (!reaction.isEnabled || reaction.eventType !== eventType) return false;
      const lastRun = this.#lastReactionAt.get(reaction.id) ?? Number.NEGATIVE_INFINITY;
      if (now - lastRun < reaction.cooldownSeconds * 1_000) return false;
      this.#lastReactionAt.set(reaction.id, now);
      return true;
    });
    const variables = {
      user: participant.senderDisplayName,
      username: participant.senderUsername,
      language: participant.language ?? configuration.policy.fallbackLanguage,
    } satisfies Partial<Record<TemplateVariable, string | number>>;
    const speechReaction = reactions.find((reaction) => reaction.speechTemplate);
    return {
      speech: speechReaction?.speechTemplate ? {
        id: `${participant.eventId}:${eventType}`,
        text: renderTemplate(speechReaction.speechTemplate, variables),
        language: participant.language ?? configuration.policy.fallbackLanguage,
        priority: eventType === 'moderator_seen' ? 'moderator' : 'normal',
      } : null,
      soundAssetIds: [...new Set(reactions.flatMap((reaction) => reaction.soundAssetId ? [reaction.soundAssetId] : []))],
    };
  }

  reset(): void {
    this.#seen.clear();
    this.#seenParticipants.clear();
    this.#lastSpokenByUser.clear();
    this.#lastReactionAt.clear();
  }

  #remember(eventId: string): void {
    this.#seen.add(eventId);
    if (this.#seen.size > MAX_DEDUPLICATION_IDS) {
      const oldest = this.#seen.values().next().value as string | undefined;
      if (oldest) this.#seen.delete(oldest);
    }
  }
}
