# CONTEXT.md — RASTO Formwork Layout Engine

Read this before doing any work in this repo. It's written so a fresh Claude
Code session can pick up the project with full awareness of the stack,
conventions, and current milestone — without re-deriving them from scratch.

## What this is

A web app for RASTO (formwork/concrete-pour engineering) that lets an
engineer lay out walls for a "pour" (יציקה), auto-tiles them with formwork
panels according to RASTO's engineering rules, and computes the accessories
(clamps, dywidag rods, struts, etc.) needed. Two deliverables per project:
a visual layout (canvas) and an export (PDF/Excel) for the field crew.

## Architecture

```
/packages/core      Pure TypeScript calculation engine — geometry, tiling,
                     accessory rules, StorageProvider interface. No DOM, no
                     Node APIs. Runs identically in the browser and on the
                     server.
/packages/web        React + TypeScript + Vite + Konva.js. The canvas
                     editor, pour manager UI, project list, config screens,
                     client-side PDF export.
/packages/server     Node.js + Fastify + TypeScript. REST API
                     (/api/projects), shared-password auth, static serving
                     of the built web app.
```

`web` and `server` both depend on `core` as a pnpm workspace dependency
(`workspace:*`). `core` depends on nothing outside itself — this is a hard
rule, not a suggestion (see "Core purity" below).

Deployment target: Render (Web Service for server+static, Managed Postgres).
Not wired up yet — lands in Milestone 3.

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

## Storage layer

`StorageProvider` interface (`core/src/storage/StorageProvider.ts`): `list`,
`load`, `save`, `duplicate`, `remove` — all async, since both real backends
are inherently asynchronous.

The interface lives in `core` because it's a pure contract, but the two
concrete implementations are **not** in `core` — they inherently have side
effects (browser storage / network), which would violate core purity.
Both live in `packages/web/src/storage/`:
- `IndexedDBProvider` — used during early core development and as an
  offline fallback. Currently a stub (throws "not implemented").
- `ApiProvider` — talks to `/api/projects`. Lands in Milestone 3. Currently
  a stub.

Provider selection is config/env driven (`VITE_STORAGE_PROVIDER` — see
`.env.example`), so swapping implementations is a one-line change
(`packages/web/src/storage/index.ts`).

Save model (spec 12.2, for when it's implemented): whole `Project` as one
atomic JSONB blob, no normalized walls/placements tables. Auto-save
debounced 3s after edits + explicit Ctrl+S. No version history in MVP.

## Auth (spec 12.3, stubbed until Milestone 3)

One shared office password via env var (`OFFICE_PASSWORD`) → simple
session/JWT. No per-user accounts or roles. All projects are visible to
everyone who's logged in (one team). Stub lives in
`packages/server/src/auth/index.ts`.

## Running things

```bash
pnpm install
pnpm dev          # web app, http://localhost:5173
pnpm dev:server   # API server, http://localhost:3000 (copy .env.example to .env first)
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

- **Milestone 1** (current): monorepo skeleton, data model types, default
  config, server skeleton, StorageProvider stubs, test infra. No tiling
  logic, no geometry, no canvas, no export, no real DB connection.
- **Milestone 2**: the core engine — geometry, tiling algorithm, accessory
  calculations, the canvas editor. This is the bulk of the work; work
  through each engineering rule as function + unit test, in spec order.
  Don't jump ahead of the spec's rule ordering.
- **Milestone 3**: `ApiProvider`, the real REST API, Postgres, auth, deploy
  to Render.

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
