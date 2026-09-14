import { describe, expect, it } from 'vitest';
import { chatContentParts } from './chat-content.js';

describe('chatContentParts', () => {
  it('replaces a TikTok placeholder with its image-backed emote', () => {
    expect(chatContentParts('[thanks]', [{ emoteId: 'thanks', imageUrl: 'https://cdn.example/thanks.png', position: 0 }]))
      .toEqual([{ type: 'emote', value: expect.objectContaining({ emoteId: 'thanks' }) }]);
  });

  it('keeps surrounding chat text', () => {
    expect(chatContentParts('Hi [wave]!', [{ emoteId: 'wave', imageUrl: 'https://cdn.example/wave.png', position: 3 }]))
      .toEqual([
        { type: 'text', value: 'Hi ' },
        { type: 'emote', value: expect.objectContaining({ emoteId: 'wave' }) },
        { type: 'text', value: '!' },
      ]);
  });
});
