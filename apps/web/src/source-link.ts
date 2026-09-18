const SOURCE_REPOSITORY = 'https://github.com/gopnikgame/TikTokHelper';
const FALLBACK_BRANCH = 'rewrite/typescript';
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export type SourceLink = {
  exact: boolean;
  label: string;
  revision: string;
  url: string;
};

export function createSourceLink(buildRevision: string | undefined): SourceLink {
  const candidate = buildRevision?.trim() ?? '';
  const exact = COMMIT_SHA_PATTERN.test(candidate);
  const revision = exact ? candidate.toLowerCase() : FALLBACK_BRANCH;

  return {
    exact,
    label: exact ? revision.slice(0, 7) : 'ветка разработки',
    revision,
    url: `${SOURCE_REPOSITORY}/tree/${revision}`,
  };
}

export const APPLICATION_SOURCE = createSourceLink(import.meta.env.VITE_SOURCE_REVISION);
