import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ChatEvent, GiftEvent, GiftSoundMapping } from '@tiktok-helper/contracts';
import { chatContentParts } from './chat-content.js';

type ChatAnchor = { sequence: string; offset: number };

function readChatAnchor(list: HTMLUListElement): ChatAnchor | null {
  const top = list.getBoundingClientRect().top;
  for (const row of list.querySelectorAll<HTMLLIElement>('li[data-chat-sequence]')) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > top && row.dataset.chatSequence) {
      return { sequence: row.dataset.chatSequence, offset: rect.top - top };
    }
  }
  return null;
}

function ChatAuthor({ message, showModerator }: { message: ChatEvent; showModerator: boolean }) {
  return <div className="chat-author">
    <strong dir="auto" title={showModerator ? message.senderDisplayName : undefined}>{message.senderDisplayName}</strong>
    <span dir="ltr" title={showModerator ? `@${message.senderUsername}` : undefined}>@{message.senderUsername}</span>
    {showModerator && message.speakerContext?.isModerator ? <span className="chat-moderator">Модератор</span> : null}
  </div>;
}

function ChatText({ message }: { message: ChatEvent }) {
  return <p className="chat-text" dir="auto">{chatContentParts(message.text, message.emotes).map((part, index) => part.type === 'text'
    ? part.value
    : <img key={`${part.value.emoteId}-${index}`} className="chat-emote" src={part.value.imageUrl} alt={`:${part.value.emoteId}:`}
      loading="lazy" referrerPolicy="no-referrer" />)}</p>;
}

interface Props {
  chat: ChatEvent[];
  gifts: GiftEvent[];
  mappings: ReadonlyMap<string, GiftSoundMapping>;
  liveOnly: boolean;
  liveActive: boolean;
  onConfigureGift: (giftId: string) => void;
}

export function LiveFeeds({ chat, gifts, mappings, liveOnly, liveActive, onConfigureGift }: Props) {
  const [mobileFeed, setMobileFeed] = useState<'chat' | 'gifts'>('chat');
  const [pinned, setPinned] = useState<ChatEvent | null>(null);
  const [followChat, setFollowChat] = useState(true);
  const chatList = useRef<HTMLUListElement>(null);
  const anchor = useRef<ChatAnchor | null>(null);
  const restoredTop = useRef<number | null>(null);

  const restoreChatScroll = useCallback(() => {
    const list = chatList.current;
    if (!list?.clientHeight) return;
    if (followChat) {
      list.scrollTop = list.scrollHeight;
    } else if (anchor.current) {
      const row = list.querySelector(`[data-chat-sequence="${anchor.current.sequence}"]`);
      if (row) {
        const rect = row.getBoundingClientRect();
        const offset = Math.max(anchor.current.offset, 1 - rect.height);
        list.scrollTop += rect.top - list.getBoundingClientRect().top - offset;
      } else {
        list.scrollTop = 0;
        anchor.current = readChatAnchor(list);
      }
    }
    restoredTop.current = list.scrollTop;
  }, [followChat]);

  useLayoutEffect(() => {
    restoreChatScroll();
  }, [chat, liveOnly, mobileFeed, pinned, restoreChatScroll]);

  useLayoutEffect(() => {
    const list = chatList.current;
    if (!list) return;
    const observer = new ResizeObserver(restoreChatScroll);
    observer.observe(list);
    return () => observer.disconnect();
  }, [restoreChatScroll]);

  function handleScroll(list: HTMLUListElement) {
    if (!list.clientHeight || Math.abs(list.scrollTop - (restoredTop.current ?? -1)) < 1) return;
    restoredTop.current = null;
    const following = list.scrollHeight - list.scrollTop - list.clientHeight < 56;
    anchor.current = following ? null : readChatAnchor(list);
    setFollowChat(following);
  }

  function unpin() {
    setPinned(null);
    chatList.current?.focus({ preventScroll: true });
  }

  return <div className="feed-grid live-view-feeds" data-mobile-feed={mobileFeed}>
    {liveOnly ? <div className="live-feed-switch" role="group" aria-label="Ленты эфира">
      <button type="button" className="quiet" aria-pressed={mobileFeed === 'chat'} aria-controls="live-chat-panel" onClick={() => setMobileFeed('chat')}>Чат</button>
      <button type="button" className="quiet" aria-pressed={mobileFeed === 'gifts'} aria-controls="live-gift-panel" onClick={() => setMobileFeed('gifts')}>Подарки</button>
    </div> : null}
    <section className="feed-panel chat-panel" id="live-chat-panel" aria-labelledby="chat-title">
      <header>
        <div>
          {liveOnly ? null : <p className="section-kicker">Прямой эфир</p>}
          <h2 id="chat-title">Чат</h2>
        </div>
        {!followChat ? <button type="button" className="quiet" onClick={() => {
          chatList.current?.focus({ preventScroll: true });
          setFollowChat(true);
        }}>К новым сообщениям</button> : null}
      </header>
      {liveOnly && pinned ? <section className="pinned-message" aria-label="Закреплённая реплика">
        <header>
          <strong>Закреплено</strong>
          <button type="button" className="quiet" aria-label="Снять закрепление" onClick={unpin}>Снять</button>
        </header>
        <div className="pinned-message-body" tabIndex={0}>
          <ChatAuthor message={pinned} showModerator />
          <ChatText message={pinned} />
        </div>
      </section> : null}
      <ul ref={chatList} className="chat-list" aria-labelledby="chat-title" aria-live="polite" aria-relevant="additions" tabIndex={0}
        onScroll={(event) => handleScroll(event.currentTarget)}>
        {chat.length === 0 ? <li className="empty-state">
          <strong>Сообщений пока нет</strong>
          <span>{liveOnly && !liveActive ? 'Подключите трансляцию в пульте.' : 'Новые реплики появятся здесь.'}</span>
        </li> : chat.map((message) => {
          const isPinned = message.sequence === pinned?.sequence;
          return <li key={message.eventId} className="chat-message" data-chat-sequence={message.sequence}>
            <ChatAuthor message={message} showModerator={liveOnly} />
            <ChatText message={message} />
            {liveOnly ? <button type="button" className="quiet chat-pin" data-pinned={isPinned}
              aria-label={isPinned ? `Открепить реплику от @${message.senderUsername}` : `Закрепить реплику от @${message.senderUsername}`}
              onClick={() => setPinned(isPinned ? null : message)}>
              {isPinned ? 'Открепить' : 'Закрепить'}
            </button> : null}
          </li>;
        })}
      </ul>
    </section>
    <aside className="feed-panel gift-panel" id="live-gift-panel" aria-labelledby="gift-title">
      <header><div>{liveOnly ? null : <p className="section-kicker">Реакции</p>}<h2 id="gift-title">Подарки</h2></div></header>
      <ul className="gift-list" aria-labelledby="gift-title" tabIndex={0}>
        {gifts.length === 0 ? <li className="empty-state">
          <strong>Ждём первый подарок</strong>
        </li> : gifts.slice(-30).toReversed().map((gift) => <li key={gift.eventId}>
          {gift.imageUrl ? <img className="gift-image" src={gift.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
            : <span className="gift-count">×{gift.repeatCount}</span>}
          <div>
            <strong dir="auto" title={liveOnly ? `${gift.giftName} ×${gift.repeatCount}` : undefined}>{gift.giftName} ×{gift.repeatCount}</strong>
            <span dir="auto" title={liveOnly ? gift.senderDisplayName : undefined}>{gift.senderDisplayName}</span>
          </div>
          <small>{mappings.has(gift.giftId) ? 'звук назначен' : `ID ${gift.giftId} · без звука`}</small>
          <button type="button" className="quiet" onClick={() => onConfigureGift(gift.giftId)}>Настроить</button>
        </li>)}
      </ul>
    </aside>
  </div>;
}
