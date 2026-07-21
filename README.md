# RASTO Formwork Layout Engine

Web app for laying out concrete formwork (panels, accessories, tiling) for
RASTO. Monorepo with a pure calculation core shared between the browser app
and the API server.

## Requirements

- Node.js >= 20
- pnpm 10.x (`corepack enable` will pick up the pinned version from `package.json`)

## Install

```bash
pnpm install
```

## Develop

```bash
pnpm dev          # starts the web app (Vite) on http://localhost:5173
pnpm dev:server   # starts the API server (Fastify) on http://localhost:3000
```

Copy `.env.example` to `.env` in the repo root before running the server.

## Test

```bash
pnpm test         # runs tests in every package
```

## Lint / format

```bash
pnpm lint
pnpm format
```

## Project structure

See [`CONTEXT.md`](./CONTEXT.md) for the full stack overview, conventions,
and milestone map.
