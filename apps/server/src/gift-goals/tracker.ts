import type { ConnectionStateEvent, GiftEvent, GiftGoalConfiguration, GiftGoalState } from '@tiktok-helper/contracts';
import { GIFT_GOAL_TOP_LIMIT } from '@tiktok-helper/contracts/gift-goal';
import { giftPoints } from '../supporters/repository.js';

type DonorTotal = GiftGoalState['topDonors'][number];

interface ActiveStatistics {
  generation: number;
  connectionId: string | null;
  state: ConnectionStateEvent['state'];
  sequence: number;
  revision: number;
  startedAt: string | null;
  goalStartedAt: string | null;
  configuration: GiftGoalConfiguration | null;
  progress: number;
  lastDonor: GiftGoalState['lastDonor'];
  donors: Map<string, DonorTotal>;
  rankedDonors: string[];
  rankingLimited: boolean;
}

const MAX_TRACKED_DONORS = 5_000;

function initialStatistics(configuration: GiftGoalConfiguration | null = null): ActiveStatistics {
  return {
    generation: 0, connectionId: null, state: 'stopped', sequence: 0, revision: 0,
    startedAt: null, goalStartedAt: null, configuration, progress: 0, lastDonor: null,
    donors: new Map(), rankedDonors: [], rankingLimited: false,
  };
}

function trackingGifts(statistics: ActiveStatistics): boolean {
  return statistics.startedAt !== null && (statistics.state === 'live' || statistics.state === 'reconnecting');
}

/** Rolls up accepted increments for the current connection of each tracked workspace. */
export class GiftGoalTracker {
  readonly #workspaces = new Map<string, ActiveStatistics>();

  constructor(private readonly now = Date.now, private readonly donorCapacity = MAX_TRACKED_DONORS) {
    if (!Number.isInteger(donorCapacity) || donorCapacity < 1) throw new Error('donorCapacity must be a positive integer');
  }

  hasWorkspace(workspaceId: string): boolean {
    return this.#workspaces.has(workspaceId);
  }

  setConfiguration(workspaceId: string, configuration: GiftGoalConfiguration | null): boolean {
    const statistics = this.#workspaces.get(workspaceId) ?? initialStatistics();
    this.#workspaces.set(workspaceId, statistics);
    const previous = statistics.configuration;
    if (!configuration) return false;
    if (previous && configuration.revision <= previous.revision) {
      // The asset's foreign key may clear an assignment without issuing a new settings revision.
      if (configuration.revision !== previous.revision || configuration.soundAssetId !== null || previous.soundAssetId === null
        || configuration.giftId !== previous.giftId || configuration.targetCount !== previous.targetCount
        || configuration.isEnabled !== previous.isEnabled) return false;
    }

    if (previous?.giftId !== configuration.giftId || previous.targetCount !== configuration.targetCount) {
      statistics.progress = 0;
      statistics.goalStartedAt = null;
    }
    if (configuration.isEnabled && statistics.goalStartedAt === null && trackingGifts(statistics)) {
      statistics.goalStartedAt = this.#timestamp();
    }
    statistics.configuration = { ...configuration };
    statistics.revision += 1;
    return true;
  }

  trackConnection(workspaceId: string, event: ConnectionStateEvent): boolean {
    const previous = this.#workspaces.get(workspaceId) ?? initialStatistics();
    if (!event.connectionId) {
      if (!this.#workspaces.has(workspaceId)) this.#workspaces.set(workspaceId, previous);
      return false;
    }
    if (event.generation < previous.generation || (event.generation === previous.generation
      && (event.connectionId !== previous.connectionId || event.sequence <= previous.sequence))) return false;

    const statistics = event.generation === previous.generation ? previous : initialStatistics(previous.configuration);
    statistics.generation = event.generation;
    statistics.connectionId = event.connectionId;
    statistics.state = event.state;
    statistics.sequence = event.sequence;
    statistics.revision = previous.revision + 1;
    if (event.state === 'live' && statistics.startedAt === null) {
      statistics.startedAt = this.#timestamp();
      if (statistics.configuration?.isEnabled) statistics.goalStartedAt = statistics.startedAt;
    }
    this.#workspaces.set(workspaceId, statistics);
    return true;
  }

  snapshot(workspaceId: string): GiftGoalState {
    const statistics = this.#workspaces.get(workspaceId) ?? initialStatistics();
    return {
      workspaceId, generation: statistics.generation, connectionId: statistics.connectionId, revision: statistics.revision,
      startedAt: statistics.startedAt, goalStartedAt: statistics.goalStartedAt,
      configuration: statistics.configuration ? { ...statistics.configuration } : null,
      progress: statistics.progress, lastDonor: statistics.lastDonor ? { ...statistics.lastDonor } : null,
      topDonors: statistics.rankedDonors.map((identityKey) => ({ ...statistics.donors.get(identityKey)! })),
      ...(statistics.rankingLimited ? { rankingLimited: true } : {}),
    };
  }

  observe(workspaceId: string, connectionId: string, gift: GiftEvent, identityKey: string): { changed: boolean; reached: boolean } {
    const statistics = this.#workspaces.get(workspaceId);
    if (!statistics || !trackingGifts(statistics) || connectionId !== statistics.connectionId
      || gift.generation !== statistics.generation || gift.sequence <= statistics.sequence
      || !Number.isSafeInteger(gift.repeatCount) || gift.repeatCount <= 0) return { changed: false, reached: false };

    const displayName = gift.senderDisplayName.slice(0, 120);
    statistics.sequence = gift.sequence;
    statistics.lastDonor = { displayName, giftId: gift.giftId, giftName: gift.giftName.slice(0, 160), quantity: gift.repeatCount };
    this.#addPoints(statistics, identityKey, displayName, giftPoints(gift));

    let reached = false;
    const configuration = statistics.configuration;
    if (configuration?.isEnabled && configuration.giftId === gift.giftId) {
      const before = statistics.progress;
      statistics.progress = Math.min(Number.MAX_SAFE_INTEGER, before + gift.repeatCount);
      reached = before < configuration.targetCount && statistics.progress >= configuration.targetCount
        && statistics.state === 'live' && !gift.historical;
    }
    statistics.revision += 1;
    return { changed: true, reached };
  }

  #addPoints(statistics: ActiveStatistics, identityKey: string, displayName: string, points: number): void {
    const previous = statistics.donors.get(identityKey);
    if (!previous && points === 0) return;
    if (!previous && statistics.donors.size >= this.donorCapacity) {
      statistics.rankingLimited = true;
      return;
    }

    const total = Math.min(Number.MAX_SAFE_INTEGER, (previous?.points ?? 0) + points);
    statistics.donors.set(identityKey, { displayName, points: total });
    if (!statistics.rankedDonors.includes(identityKey)) statistics.rankedDonors.push(identityKey);
    statistics.rankedDonors.sort((left, right) => {
      const byPoints = statistics.donors.get(right)!.points - statistics.donors.get(left)!.points;
      return byPoints || left.localeCompare(right);
    });
    if (statistics.rankedDonors.length > GIFT_GOAL_TOP_LIMIT) statistics.rankedDonors.pop();
  }

  #timestamp(): string { return new Date(this.now()).toISOString(); }
}
