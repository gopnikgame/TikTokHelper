# Development

## Prerequisites

- Node.js 24 or newer
- pnpm 11.19.0 (declared in the root `package.json`)

## Commands

```bash
pnpm install --frozen-lockfile
pnpm run dev
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify
```

`pnpm run verify` is the standard local completion gate. The server health test uses `fastify.inject()` and does not open a network port.

## Workspace layout

- `apps/server`: Fastify process and HTTP API
- `apps/web`: React/Vite browser application
- `packages/contracts`: project-owned types and runtime schemas shared across boundaries

The legacy ASP.NET/Electron implementation is preserved by Git tag `legacy-aspnet-final`. New work is developed on `rewrite/typescript`.

## Source references

- Fastify TypeScript setup and JSON Schema: https://fastify.dev/docs/latest/Reference/TypeScript/
- Fastify testing with `inject()`: https://fastify.dev/docs/latest/Guides/Testing/
- Vite React scaffolding and Node requirements: https://vite.dev/guide/
- pnpm workspace layout: https://pnpm.io/workspaces
- Node.js release status: https://nodejs.org/en/about/previous-releases
