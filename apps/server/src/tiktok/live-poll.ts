import { createHash, randomUUID } from 'node:crypto';
import { LIVE_POLL_MAX_VOTERS, type LivePoll, type LivePollState, type StartLivePoll } from '@tiktok-helper/contracts';
import type { NormalizedChat } from './normalizer.js';

const VOTE_COMMAND = /^!([1-4])$/;
const NUMERIC_USER_ID = /^[1-9]\d{0,19}$/;
const MAX_KEYS_PER_VOTER = 3;

function voterKeys(event: NormalizedChat, pollId: string): string[] {
  const username = event.senderUsername.toLocaleLowerCase('en-US');
  const userId = event.participant?.userId;
  const identities: string[] = [];
  if (username !== '0' && username.length <= 64) identities.push(`username:${username}`);
  if (userId && NUMERIC_USER_ID.test(userId)) identities.push(`id:${userId}`);
  if (event.participant?.secUidAvailable) identities.push(`secUid:${event.senderIdentityKey}`);
  return identities.map((identity) => createHash('sha256').update(pollId).update('\0').update(identity).digest('hex'));
}

export class LivePollTracker {
  #poll: LivePoll | null = null;
  #revision = 0;
  #totalVotes = 0;
  readonly #voterKeys = new Set<string>();

  start({ previousPollId, question, options }: StartLivePoll): boolean {
    if (this.#poll?.status === 'open' || (this.#poll?.id ?? null) !== previousPollId) return false;
    this.#poll = { id: randomUUID(), question, options: options.map((label) => ({ label, votes: 0 })), status: 'open' };
    this.#totalVotes = 0;
    this.#revision += 1;
    return true;
  }

  close(pollId?: string): 'updated' | 'already-closed' | undefined {
    if (!this.#poll || (pollId !== undefined && pollId !== this.#poll.id)) return undefined;
    if (this.#poll.status === 'closed') return 'already-closed';
    this.#poll.status = 'closed';
    this.#voterKeys.clear();
    this.#revision += 1;
    return 'updated';
  }

  accept(event: NormalizedChat): boolean {
    if (this.#poll?.status !== 'open') return false;
    const command = VOTE_COMMAND.exec(event.text);
    const option = command && this.#poll.options[Number(command[1]) - 1];
    if (!option) return false;

    const keys = voterKeys(event, this.#poll.id);
    if (keys.length === 0) return false;
    const alreadyVoted = keys.some((key) => this.#voterKeys.has(key));
    if (!alreadyVoted) this.#totalVotes += 1;
    // A repeat can reveal a missing identifier. Keep the total number of keys bounded.
    for (const key of keys) {
      if (this.#voterKeys.size >= this.#totalVotes * MAX_KEYS_PER_VOTER) break;
      this.#voterKeys.add(key);
    }
    if (alreadyVoted) return false;

    option.votes += 1;
    if (this.#totalVotes === LIVE_POLL_MAX_VOTERS) this.close();
    else this.#revision += 1;
    return true;
  }

  snapshot(workspaceId: string, generation: number, connectionId: string): LivePollState {
    const poll = this.#poll && { ...this.#poll, options: this.#poll.options.map((option) => ({ ...option })) };
    return { workspaceId, generation, connectionId, revision: this.#revision, poll };
  }
}
