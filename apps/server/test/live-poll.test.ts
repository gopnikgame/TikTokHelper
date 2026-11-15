import { LIVE_POLL_MAX_VOTERS, type RealtimeEvent, type StartLivePoll } from '@tiktok-helper/contracts';
import { describe, expect, it, vi } from 'vitest';
import { LivePollTracker } from '../src/tiktok/live-poll.js';
import type { NormalizedChat } from '../src/tiktok/normalizer.js';
import { TikTokSessionManager, type Scheduler } from '../src/tiktok/session-manager.js';
import { ScriptedConnector } from './helpers/scripted-connector.js';

function pollInput(connectionId: string, previousPollId: string | null = null): StartLivePoll {
  return { connectionId, previousPollId, question: 'What should we play next?', options: ['Piano', 'Drums'] };
}

function chat(comment: string, msgId: string, uniqueId = 'viewer') {
  return { comment, common: { msgId }, user: { uniqueId } };
}

describe('Live chat polls', () => {
  it('accepts complete commands from distinct viewers and ignores history, replay and identity changes', async () => {
    const connector = new ScriptedConnector([], '11');
    const sink = vi.fn<(_workspaceId: string, event: RealtimeEvent) => void>();
    const manager = new TikTokSessionManager(() => connector, sink);
    const session = await manager.start('primary', 'streamer');
    const input = pollInput(session.connectionId!);
    expect(manager.startLivePoll('primary', input)?.poll).toMatchObject({ status: 'open' });

    for (const [i, comment] of ['1', '!0', '!3', '! 1', '!1 yes', '!1 !2', 'hello !2'].entries()) {
      connector.emit('chat', chat(comment, `invalid-${i}`));
    }
    const history = chat('!2', 'historical', 'history_viewer');
    connector.emit('chat', history, true);
    connector.emit('chat', history);
    expect(manager.getLivePoll('primary').revision).toBe(1);

    connector.emit('chat', chat('  !1\t', 'first', 'FirstViewer'));
    connector.emit('chat', chat('!2', 'first', 'replayed_viewer'));
    connector.emit('chat', {
      ...chat('!2', 'second', 'firstviewer'), user: { uniqueId: 'firstviewer', secUid: 'fixture-secuid', id: '101' },
    });
    connector.emit('chat', {
      ...chat('!2', 'third', 'viewer_renamed'), user: { uniqueId: 'viewer_renamed', secUid: 'fixture-secuid' },
    });
    connector.emit('chat', {
      ...chat('!2', 'fourth', 'viewer_renamed_again'), user: { uniqueId: 'viewer_renamed_again', id: '101' },
    });
    connector.emit('chat', chat('!2', 'fifth', 'other_viewer'));

    expect(manager.getLivePoll('primary')).toMatchObject({
      revision: 3, poll: { options: [{ label: 'Piano', votes: 1 }, { label: 'Drums', votes: 1 }] },
    });
    const events = sink.mock.calls.map(([, event]) => event);
    expect(events.filter((event) => event.type === 'chat.message' && event.eventId === 'historical')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'chat.message' && event.eventId === 'first')).toHaveLength(1);
    expect(events.every((event) => !Object.hasOwn(event, 'upstreamEventId') && !Object.hasOwn(event, 'senderIdentityKey'))).toBe(true);
    await manager.close();
  });

  it('counts the same command without a message ID once in each successive poll and closes idempotently', async () => {
    const connector = new ScriptedConnector([], '11');
    const sink = vi.fn<(_workspaceId: string, event: RealtimeEvent) => void>();
    const manager = new TikTokSessionManager(() => connector, sink);
    const session = await manager.start('primary', 'streamer');
    const input = pollInput(session.connectionId!);
    const firstPoll = manager.startLivePoll('primary', input)!.poll!;
    expect(manager.startLivePoll('primary', input)).toBeUndefined();

    const message = { comment: '!1', user: { uniqueId: 'viewer' } };
    const knownMessage = chat('!2', 'known-message', 'known_viewer');
    connector.emit('chat', message);
    connector.emit('chat', message);
    connector.emit('chat', knownMessage);
    const closed = manager.closeLivePoll('primary', firstPoll.id);
    expect(closed?.poll).toMatchObject({ status: 'closed', options: [{ votes: 1 }, { votes: 1 }] });
    expect(manager.closeLivePoll('primary', firstPoll.id)).toEqual(closed);
    expect(manager.startLivePoll('primary', input)).toBeUndefined();

    const secondPoll = manager.startLivePoll('primary', pollInput(input.connectionId, firstPoll.id))!.poll!;
    expect(secondPoll.id).not.toBe(firstPoll.id);
    expect(manager.closeLivePoll('primary', firstPoll.id)).toBeUndefined();
    connector.emit('chat', message, true);
    connector.emit('chat', knownMessage);
    expect(manager.getLivePoll('primary').poll?.options.map(({ votes }) => votes)).toEqual([0, 0]);
    connector.emit('chat', message);
    expect(manager.getLivePoll('primary').poll?.options.map(({ votes }) => votes)).toEqual([1, 0]);
    expect(sink.mock.calls.filter(([, event]) => event.type === 'chat.message')).toHaveLength(2);
    await manager.close();
  });

  it('keeps the poll through a same-room reconnect and isolates workspace and connection changes', async () => {
    const first = new ScriptedConnector([], '11');
    const second = new ScriptedConnector([], '11');
    const resumed = new ScriptedConnector([], '11');
    const changed = new ScriptedConnector([], '22');
    const restarted = new ScriptedConnector([], '22');
    const connectors = [first, second, resumed, changed, restarted];
    const scheduled: Array<() => void> = [];
    const scheduler: Scheduler = {
      set(_delay, callback) { scheduled.push(callback); return callback; },
      clear(handle) {
        const index = scheduled.findIndex((callback) => callback === handle);
        if (index >= 0) scheduled.splice(index, 1);
      },
    };
    const manager = new TikTokSessionManager(() => connectors.shift()!, undefined, scheduler);
    const session = await manager.start('primary', 'streamer');
    const secondary = await manager.start('secondary', 'streamer');
    const source = pollInput(session.connectionId!);
    expect(manager.startLivePoll('secondary', source)).toBeUndefined();
    manager.startLivePoll('primary', source);
    manager.startLivePoll('secondary', pollInput(secondary.connectionId!));
    first.emit('chat', chat('!1', 'shared'));
    second.emit('chat', chat('!2', 'shared'));

    const beforeReconnect = manager.getLivePoll('primary');
    first.emit('disconnected', {});
    expect(manager.status('primary').state).toBe('reconnecting');
    expect(manager.getLivePoll('primary')).toEqual(beforeReconnect);
    scheduled.shift()!();
    await vi.waitFor(() => expect(manager.status('primary').state).toBe('live'));
    expect(manager.getLivePoll('primary')).toEqual(beforeReconnect);
    resumed.emit('chat', chat('!2', 'different_message'));
    expect(manager.getLivePoll('primary')).toEqual(beforeReconnect);

    resumed.emit('disconnected', {});
    scheduled.shift()!();
    await vi.waitFor(() => expect(manager.status('primary').state).toBe('live'));
    const newSession = manager.getLivePoll('primary');
    expect(newSession).toMatchObject({ generation: session.generation + 1, revision: 0, poll: null });
    expect(newSession.connectionId).not.toBe(session.connectionId);
    expect(manager.startLivePoll('primary', source)).toBeUndefined();
    manager.startLivePoll('primary', pollInput(newSession.connectionId!));
    changed.emit('chat', chat('!2', 'shared'));
    changed.emit('streamEnd', {});
    expect(manager.getLivePoll('primary').poll).toMatchObject({ status: 'closed', options: [{ votes: 0 }, { votes: 1 }] });
    expect(manager.getLivePoll('secondary').poll).toMatchObject({ status: 'open', options: [{ votes: 0 }, { votes: 1 }] });

    await manager.stop('primary');
    expect(manager.getLivePoll('primary').poll?.status).toBe('closed');
    const manualRestart = await manager.start('primary', 'streamer');
    expect(manager.getLivePoll('primary')).toMatchObject({ connectionId: manualRestart.connectionId, poll: null });
    await manager.close();
  });

  it('accepts the last available vote, then closes the poll and rejects further votes', () => {
    const tracker = new LivePollTracker();
    tracker.start(pollInput('fixture-connection'));
    const event: NormalizedChat = {
      type: 'chat.message', generation: 1, sequence: 1, text: '!1', eventId: 'fixture-event',
      senderDisplayName: 'Fixture', senderUsername: 'fixture', senderIdentityKey: 'unused-without-secuid',
    };
    for (let index = 1; index <= LIVE_POLL_MAX_VOTERS; index++) {
      tracker.accept({ ...event, senderUsername: `fixture${index}` });
    }
    expect(tracker.accept({ ...event, senderUsername: 'one-more' })).toBe(false);
    expect(tracker.snapshot('primary', 1, 'fixture-connection')).toMatchObject({
      revision: LIVE_POLL_MAX_VOTERS + 1,
      poll: { status: 'closed', options: [{ votes: LIVE_POLL_MAX_VOTERS }, { votes: 0 }] },
    });
  });
});
