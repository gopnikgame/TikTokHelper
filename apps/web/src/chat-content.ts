import type { ChatEmote } from '@tiktok-helper/contracts';

export type ChatContentPart = { type: 'text'; value: string } | { type: 'emote'; value: ChatEmote };

export function chatContentParts(text: string, emotes: ChatEmote[] = []): ChatContentPart[] {
  const parts: ChatContentPart[] = [];
  let cursor = 0;
  for (const emote of [...emotes].sort((left, right) => left.position - right.position)) {
    let start = Math.max(cursor, Math.min(text.length, emote.position));
    let end = start;
    if (text[start] === '[') {
      const closing = text.indexOf(']', start + 1);
      if (closing >= 0) end = closing + 1;
    } else {
      const placeholder = text.indexOf('[', cursor);
      const closing = placeholder >= 0 ? text.indexOf(']', placeholder + 1) : -1;
      if (placeholder >= 0 && closing >= 0) { start = placeholder; end = closing + 1; }
    }
    if (start > cursor) parts.push({ type: 'text', value: text.slice(cursor, start) });
    parts.push({ type: 'emote', value: emote });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}
