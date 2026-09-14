FROM node:24.18.0-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:24.18.0-bookworm-slim AS runtime
ENV HOST=0.0.0.0 PORT=3000 WEB_ROOT=/app/apps/web/dist SOUND_ROOT=/app/builtin-sounds
WORKDIR /app
COPY --from=build --chown=node:node /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps ./apps
COPY --from=build --chown=node:node /workspace/packages ./packages
COPY --chown=node:node wwwroot/Assets/Sounds ./builtin-sounds
COPY --chown=node:node deploy/entrypoint.sh /usr/local/bin/tiktok-helper-entrypoint
RUN chmod 0555 /usr/local/bin/tiktok-helper-entrypoint
USER node
EXPOSE 3000
ENTRYPOINT ["tiktok-helper-entrypoint"]
CMD ["node", "apps/server/dist/index.js"]
