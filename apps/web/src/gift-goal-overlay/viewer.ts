import {
  GIFT_GOAL_OVERLAY_TOKEN_HEADER, isGiftGoalOverlaySnapshot, isGiftGoalOverlayToken,
  isLastGiftOverlaySnapshot, isLikeGoalOverlaySnapshot, isLivePollOverlaySnapshot, isStreamOverlayKind,
  type LastGiftOverlaySnapshot, type LivePollOverlaySnapshot, type StreamOverlayKind,
} from '@tiktok-helper/contracts/overlays';
import { appPath } from '../app-path.js';
import './viewer.css';

const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;
const numberFormat = new Intl.NumberFormat('ru-RU');
const titles: Record<StreamOverlayKind, string> = {
  'gift-goal': 'Цель по подаркам',
  'last-gift': 'Последний подарок',
  'like-goal': 'Цель по лайкам',
  'live-poll': 'Голосование',
};

interface Viewer {
  kind: StreamOverlayKind;
  token: string;
  search: string;
  request?: AbortController;
  timer?: number;
}

interface PollRow {
  element: HTMLLIElement;
  command: HTMLElement;
  label: HTMLElement;
  votes: HTMLElement;
}

const overlay = document.getElementById('gift-goal-overlay');
const title = document.getElementById('gift-goal-title');
const goalFields = document.getElementById('goal-overlay-fields');
const name = document.getElementById('gift-goal-name');
const count = document.getElementById('gift-goal-count');
const progress = document.querySelector<HTMLProgressElement>('#gift-goal-progress');
const completed = document.getElementById('gift-goal-completed');
const pollFields = document.getElementById('poll-overlay-fields');
const pollQuestion = document.getElementById('live-poll-question');
const pollHint = document.getElementById('live-poll-hint');
const pollResults = document.getElementById('live-poll-results');
const pollOptions = document.getElementById('live-poll-options');
const pollRows: PollRow[] = [];

let viewer: Viewer | undefined;
let giftExpiry: number | undefined;

function setText(element: HTMLElement | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function setHidden(element: HTMLElement | null, hidden: boolean): void {
  if (element && element.hidden !== hidden) element.hidden = hidden;
}

function conceal(): void {
  setHidden(overlay, true);
  window.clearTimeout(giftExpiry);
  giftExpiry = undefined;
  setText(name, '');
  setText(count, '');
  setHidden(name, true);
  setHidden(completed, true);
  if (progress) {
    progress.max = 1;
    progress.value = 0;
  }
  setText(pollQuestion, '');
  setHidden(pollHint, true);
  setHidden(pollResults, true);
  if (pollRows.length) {
    pollOptions?.replaceChildren();
    pollRows.length = 0;
  }
}

function renderGoal(giftName: string | null, value: number, target: number): void {
  setText(name, giftName ?? '');
  setHidden(name, !giftName);
  setText(count, numberFormat.format(value) + ' из ' + numberFormat.format(target));
  setHidden(progress, false);
  if (progress) {
    if (progress.max !== target) progress.max = target;
    const visibleValue = Math.min(value, target);
    if (progress.value !== visibleValue) progress.value = visibleValue;
  }
  setHidden(completed, value < target);
  setHidden(overlay, false);
}

function renderLastGift(current: Viewer, snapshot: LastGiftOverlaySnapshot, requestedAt: number): void {
  // Use the request start so a delayed response cannot extend the server's display window.
  const remaining = requestedAt + snapshot.remainingMs - performance.now();
  if (remaining <= 0) {
    conceal();
    return;
  }
  setText(name, snapshot.giftName);
  setHidden(name, false);
  setText(count, '×' + numberFormat.format(snapshot.quantity));
  setHidden(progress, true);
  setHidden(completed, true);
  setHidden(overlay, false);
  window.clearTimeout(giftExpiry);
  giftExpiry = window.setTimeout(() => { if (viewer === current) conceal(); }, remaining);
}

function createPollRow(index: number): PollRow {
  const element = document.createElement('li');
  const answer = document.createElement('span');
  answer.className = 'poll-overlay-answer';
  const command = document.createElement('code');
  command.className = 'poll-overlay-command';
  command.textContent = '!' + (index + 1);
  const label = document.createElement('bdi');
  label.className = 'poll-overlay-label';
  const votes = document.createElement('span');
  votes.className = 'poll-overlay-votes';
  answer.append(command, label);
  element.append(answer, votes);
  return { element, command, label, votes };
}

function renderPoll(snapshot: LivePollOverlaySnapshot): void {
  const open = snapshot.status === 'open';
  setText(pollQuestion, snapshot.question);
  setHidden(pollHint, !open);
  setHidden(pollResults, open);
  // Update counts in place so the list and its accessible labels stay stable.
  snapshot.options.forEach((option, index) => {
    let row = pollRows[index];
    if (!row) {
      row = createPollRow(index);
      pollRows.push(row);
      pollOptions?.append(row.element);
    }
    setHidden(row.command, !open);
    setText(row.label, option.label);
    setText(row.votes, numberFormat.format(option.votes));
  });
  while (pollRows.length > snapshot.options.length) pollRows.pop()?.element.remove();
  setHidden(overlay, false);
}

function renderPayload(current: Viewer, payload: unknown, requestedAt: number): void {
  if (current.kind === 'gift-goal' && isGiftGoalOverlaySnapshot(payload)) {
    renderGoal(payload.giftName, payload.progress, payload.targetCount);
  } else if (current.kind === 'like-goal' && isLikeGoalOverlaySnapshot(payload)) {
    renderGoal(null, payload.progress, payload.targetCount);
  } else if (current.kind === 'last-gift' && isLastGiftOverlaySnapshot(payload)) {
    renderLastGift(current, payload, requestedAt);
  } else if (current.kind === 'live-poll' && isLivePollOverlaySnapshot(payload)) {
    renderPoll(payload);
  } else {
    conceal();
  }
}

function isCurrent(current: Viewer): boolean {
  return current === viewer && window.location.search === current.search
    && window.location.hash === '#' + current.token;
}

async function poll(current: Viewer): Promise<void> {
  if (!isCurrent(current)) return;
  const request = new AbortController();
  current.request = request;
  const timeout = window.setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
  const requestedAt = performance.now();
  try {
    const response = await fetch(appPath('api/overlays/' + current.kind), {
      headers: { [GIFT_GOAL_OVERLAY_TOKEN_HEADER]: current.token },
      mode: 'same-origin',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: request.signal,
    });
    if (!isCurrent(current)) return;
    if (response.status === 401) {
      conceal();
      return;
    }
    if (response.ok) {
      const payload: unknown = await response.json();
      if (isCurrent(current)) renderPayload(current, payload, requestedAt);
    } else if (current.kind !== 'last-gift' || response.status < 500) {
      conceal();
    }
  } catch {
    if (isCurrent(current) && current.kind !== 'last-gift') conceal();
  } finally {
    window.clearTimeout(timeout);
    current.request = undefined;
  }
  if (isCurrent(current)) current.timer = window.setTimeout(() => { void poll(current); }, POLL_INTERVAL_MS);
}

function stopViewer(): void {
  const previous = viewer;
  viewer = undefined;
  previous?.request?.abort();
  window.clearTimeout(previous?.timer);
  conceal();
}

function readLink(): void {
  stopViewer();
  const search = window.location.search;
  const views = new URLSearchParams(search).getAll('view');
  const kind = views.length === 0 ? 'gift-goal' : views[0];
  const token = window.location.hash.slice(1);
  if (views.length > 1 || !isStreamOverlayKind(kind) || !isGiftGoalOverlayToken(token)) return;
  if (overlay) overlay.dataset.view = kind;
  setText(title, titles[kind]);
  document.title = titles[kind];
  setHidden(goalFields, kind === 'live-poll');
  setHidden(pollFields, kind !== 'live-poll');
  viewer = { kind, token, search };
  void poll(viewer);
}

window.addEventListener('hashchange', readLink);
window.addEventListener('pagehide', stopViewer);
window.addEventListener('pageshow', (event) => { if (event.persisted) readLink(); });
readLink();
