import { describe, expect, it } from 'vitest';

import { createSourceLink } from './source-link.js';

describe('application source link', () => {
  it('links an exact build commit and displays its short revision', () => {
    const revision = '9a343e5366b5d4bec8aac18f3ad62b45883729d7';

    expect(createSourceLink(revision)).toEqual({
      exact: true,
      label: '9a343e5',
      revision,
      url: `https://github.com/gopnikgame/TikTokHelper_ASP.NET/tree/${revision}`,
    });
  });

  it('uses the public development branch outside a revisioned build', () => {
    expect(createSourceLink(undefined)).toMatchObject({
      exact: false,
      label: 'ветка разработки',
      revision: 'rewrite/typescript',
    });
  });

  it('does not put arbitrary build input into a public URL', () => {
    expect(createSourceLink('../private')).toMatchObject({
      exact: false,
      revision: 'rewrite/typescript',
    });
  });
});
