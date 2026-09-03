# CONTEXT.md — RASTO Formwork Layout Engine

Read this before doing any work in this repo. It's written so a fresh Claude
Code session can pick up the project with full awareness of the stack,
conventions, and current milestone — without re-deriving them from scratch.

## What this is

A web app for RASTO (formwork/concrete-pour engineering) that lets an
engineer lay out walls for a "pour" (יציקה), tile them with formwork panels
on an explicit **חשב** action, and compute the accessories
(clamps, dywidag rods, struts, etc.) needed. Two deliverables per project:
a visual layout (canvas) and an export (PDF/Excel) for the field crew.

## Architecture

```
/packages/core      Pure TypeScript calculation engine — geometry, contour
                     resolution, tiling, accessory rules, StorageProvider
                     interface. No DOM, no Node APIs. Runs identically in the
                     browser and on the server.
/packages/web        React + TypeScript + Vite + Konva.js. The canvas
                     editor, pour manager UI, project list, config screens,
                     client-side PDF export.
/packages/server     Node.js + Fastify + TypeScript. REST API
                     (/api/projects), per-user cookie-session auth, Postgres
                     ownership isolation, and health endpoints.
```

`web` and `server` both depend on `core` as a pnpm workspace dependency
(`workspace:*`). `core` depends on nothing outside itself — this is a hard
rule, not a suggestion (see "Core purity" below).

The current Vercel project builds only the static web app; it does not host the
Fastify API and currently has no environment variables. A working deployment
therefore still needs a backend deployment, a real `VITE_API_BASE_URL` for the web build, and
`DATABASE_URL`, `WEB_ORIGIN`, and `AUTH_SECRET` as server/deployment secrets.
Production is not considered closed: no real Neon + browser end-to-end run has
been completed yet.

## Core purity — the most important convention

Every function in `packages/core` must be deterministic: state in, state
out. No side effects, no `window`/`document`, no `fs`/`process`, no network
calls. This is what lets the same engine run instantly in the browser
canvas and, if ever needed, on the server — and what makes it fully unit
testable without mocking a DOM or a filesystem.

Concretely:
- `core`'s `tsconfig.json` sets `"types": []` so DOM/Node ambient types
  can't silently leak in.
- Every engineering rule (tiling, corner offsets, accessory formulas) is a
  plain function with a unit test. No exceptions.
- If you think `core` needs a DOM or Node API, stop — that logic belongs in
  `web` or `server`, with `core` only supplying the pure calculation.

## Data model

Defined in `packages/core/src/types.ts`: `Project`, `Pour`, `Wall`, `Node`,
`Edge`, `Placement`, `PanelCatalog`, `AccessoryRules`. Types only in
Milestone 1 — geometry/tiling logic is implemented in Milestone 2.
Read that file for the authoritative shape and field-level comments before
touching anything that constructs or consumes these objects.

## Engineering rules to know about (implemented in Milestone 2)

These are the rules golden tests will be built around. Get them right; get
the field crew wrong numbers and it's a physical, on-site problem.

- **Contour resolution** (`core/src/contours/`): the engine decides what the
  user drew before it tiles anything. Planar face traversal
  (`geometry/planarFaces.ts`) splits the wall graph into regions; regions whose
  boundary pairs up across a constant wall-like gap are *wall material*, not
  rooms, which is how a plan traced as an inner AND an outer rectangle collapses
  into one wall ring instead of two doubled-up wall sets. From that fall out:
  each wall's outward direction (never the drag direction), whether each face
  borders a room, and which drawn walls were only somebody else's far face
  (`consumedWallIds` — never tiled). `Placement.side` is `faceA`/`faceB`;
  whether a face borders a room is the separate `faceIsInterior`.
- **Middle rule** (חוק האמצע): tiling fills leading panels from the edges
  and puts the remainder panel in the middle. Canonical check: 340cm →
  4×75 + 40 in the middle.
- **Corner offset**: how corner panels (e.g. C30x30) offset the adjacent
  straight run.
- **Inside/outside Dywidag sync**: dywidag rod placement must line up
  between the inner and outer wall faces.
- **Accessory formulas**: clamps per corner/joint, dywidag+nuts per rod,
  strut spacing, crane adapters — see `core/src/defaults.ts` for the
  current constants (`DEFAULT_ACCESSORY_RULES`).
- Two real customer layouts will serve as **golden tests** once tiling is
  implemented — output gets diffed against them during tuning.

### Manual compute policy

The user's latest decision overrides the original Milestone 2/Stage 5
auto-compute plan: `tileProject` / `compute` run only after an explicit click
on **חשב**. Geometry changes, deletion, undo/restore of a side, and closing a
room may clear the current layout or mark `layoutDirty`, but must never start
the engine through an effect, timer, or debounce. Restored panels appear only
after the user clicks **חשב** again.

## Storage layer

`StorageProvider` interface (`core/src/storage/StorageProvider.ts`): `list`,
`load`, `save`, `duplicate`, `remove` — all async, since both real backends
are inherently asynchronous.

The interface lives in `core` because it's a pure contract, but the two
concrete implementations are **not** in `core` — they inherently have side
effects (browser storage / network), which would violate core purity.
Both live in `packages/web/src/storage/`:
- `ApiProvider` — the normal account-backed mode; talks to `/api/projects`
  with credentials included.
- `IndexedDBProvider` — implemented browser-only offline storage. It must be
  selected explicitly and has no accounts or server synchronization.

Provider selection is config/env driven in `packages/web/src/storage/index.ts`.
The default mode is `api`; set `VITE_STORAGE_PROVIDER=indexeddb` explicitly for
offline use. Local Vite settings belong in `packages/web/.env.local`, including
a real `VITE_API_BASE_URL` in API mode.

The save model stores a whole `Project` as one atomic JSONB blob, with no
normalized walls/placements tables. Auto-save is debounced after edits and
flushes before project create/open/remove transitions. No version history in MVP.
Auto-save persists project state only; it must never invoke `tileProject` or
`compute`. Auto-save remains enabled, while auto-compute is forbidden.

## Auth and project ownership

Per-user email/password accounts are implemented. The server exposes
`register`, `login`, `logout`, and `me`, issues a signed HTTP-only session
cookie, and hashes passwords. `AuthGate` protects the API-backed web app.
Every project query enforces `user_id` ownership in SQL.

Open registration currently works. A production registration gate or invite
policy still awaits an explicit user decision; do not invent one. Legacy
`projects` rows whose `user_id` is `NULL` are not assigned automatically and
remain unreachable through owned project queries until an operator assigns
them to a real account. Only then can the database finish enforcing
`projects.user_id NOT NULL`.

## Running things

```bash
pnpm install
pnpm dev          # web app, http://localhost:5173
pnpm dev:server   # API server, http://localhost:3000; reads process/deployment env
pnpm test         # every package's tests (Vitest in core)
pnpm lint
pnpm format
pnpm typecheck
```

## Code conventions

- TypeScript strict mode everywhere (base config: `tsconfig.base.json`,
  each package extends it).
- ESLint (flat config, `eslint.config.js`) + Prettier, both defined once at
  repo root and shared by all packages.
- Variable/function names in English. Domain terms from the spec may stay
  in their original form where that's clearer (`pour`, `leadingPanel`,
  `dywidag`, etc.) rather than being forced into awkward translations.
- No comments explaining *what* code does — names should make that
  redundant. Comments only for non-obvious *why* (a constraint, an
  engineering rule reference, a workaround).
- Small, logical commits. Don't batch unrelated changes.

## Milestones (spec section 9)

- **Milestone 1:** complete — monorepo, data model, defaults, storage contract,
  server/test infrastructure.
- **Milestone 2:** the core engine, parallel-face tiling, canvas, quantities,
  diagnostics, and manual **חשב** flow are implemented. Customer engineering
  questions and full manual acceptance remain separate closure gates.
- **Milestone 3:** `ApiProvider`, Postgres CRUD, account auth, `AuthGate`, and
  SQL ownership isolation are implemented in code. Deployment configuration,
  a real Neon/browser end-to-end run, the registration/invite policy, and
  assignment of any ownerless legacy projects are still open.

Each milestone is done only when it meets its Definition of Done from the
spec — not "roughly working."

## Open engineering questions

`docs/open-questions.md` tracks every rule the engine could not derive from
the customer's own sources, with the evidence (formulas pulled out of their
real BOM sheets) next to each one. Read it before changing an accessory
formula — several plausible-looking numbers are deliberately NOT implemented
because the sources disagree.

## When something isn't covered by the spec

Stop and flag it rather than guessing — especially for architectural
decisions. If the spec seems to contradict itself or is ambiguous, surface
that explicitly before implementing around it.
