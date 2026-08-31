# RastoPlan project instructions

## תקשורת עם המשתמש

**כל הפלט למשתמש בעברית פשוטה וברורה.** זו העדפה קבועה, לא בקשה חד־פעמית.

- משפטים קצרים. בלי מילים גבוהות ובלי ז'רגון מיותר.
- מונחי דומיין ושמות קוד נשארים באנגלית (`Placement`, `faceA`, `tileWallPair`).
- להסביר *למה*, לא רק *מה*. אם משהו נשבר — לומר בדיוק מה ומה המשמעות.
- טבלאות וצ'קליסטים עדיפים על פסקאות ארוכות.
- מסמכים שנוצרים עבור המשתמש (QA, תוכניות, סיכומים) — באותה עברית פשוטה.

## 0. Start here

Before doing any work:

1. Read the user's current request and identify the approved scope.
2. Read `CONTEXT.md` for architecture and conventions.
3. Read the relevant section of `docs/plan-parallel-formwork.md` when the task concerns parallel face tiling, authentication, persistence, or the staged implementation plan.
4. Read `docs/open-questions.md` before changing geometry, tiling, corners, accessories, inventory, or BOM formulas.
5. Read `packages/core/src/types.ts`, `packages/core/src/defaults.ts`, and the relevant tests before changing an engineering rule or persisted shape.
6. Run `git status --short` and preserve all pre-existing user changes.

Do not assume the milestone label in `CONTEXT.md` is current. The repository already contains substantial geometry, contour, tiling, corner, accessory, canvas, storage, and export code. Verify the actual code and recent tests.

There is no `TASKS.md` in this repository. Do not invent one. Use the current user request and the explicitly approved scope in the relevant plan as the task boundary.

### Source-of-truth order

When sources disagree, use this order:

1. The user's latest explicit decision or approved scope.
2. Explicit approval gates and decisions in `docs/plan-parallel-formwork.md`.
3. Confirmed decisions and unresolved questions in `docs/open-questions.md`.
4. The authoritative data model and constants in `packages/core/src/types.ts` and `packages/core/src/defaults.ts`.
5. Existing focused tests and current behavior.
6. General background in `CONTEXT.md` and `README.md`.

Do not silently choose between conflicting engineering interpretations. Report the conflict and stop at the relevant approval gate.

### Customer and reference artifacts

Treat root-level drawings, images, spreadsheets, AutoCAD sidecars/backups, and other customer artifacts as read-only evidence. In particular, do not rename, move, replace, re-encode, or delete `image.png`, `cuircuit ex.png`, `*.dwl`, `*.dwl2`, or `*.bak` unless the user explicitly requests it.

Do not treat an AutoCAD sidecar or backup as authoritative over the user's approved interpretation. If a drawing is unclear, extract observations and ask for a decision; do not guess a physical rule.

---

## 1. Project architecture

RastoPlan is a pnpm monorepo for laying out RASTO concrete formwork, rendering the result, and calculating/exporting quantities.

- `packages/core`: pure deterministic TypeScript engine. Geometry, contour resolution, wall-face pairing, tiling, corners, accessories, migration, export templates, shared types, and the `StorageProvider` contract.
- `packages/web`: React + Vite + Konva application. Canvas interaction and rendering, state, panels, browser/API storage providers, inventory import, and XLSX writing.
- `packages/server`: Fastify API, configuration, auth, project routes, and database integration.
- `docs`: approved implementation plans and unresolved customer/engineering questions.
- `spikes`: disposable investigation code. A successful spike is evidence, not production architecture.

`web` and `server` may depend on `core`. `core` must not depend on either of them.

### Core purity is non-negotiable

Everything in `packages/core` must remain deterministic and side-effect free:

- no DOM, React, Konva, browser storage, network, filesystem, process, timers, or database access;
- state in, result out;
- engineering rules belong in small pure functions with focused tests;
- concrete storage implementations stay outside `core`;
- do not weaken `packages/core/tsconfig.json` to make environment-specific code compile.

If a proposed core change needs an external API, move that integration to `web` or `server` and pass plain data into the core.

---

## 2. Domain and engineering invariants

This software produces quantities used for physical field work. Plausible-looking output is not enough.

- All geometry coordinates, lengths, heights, widths, gaps, offsets, and thicknesses are in centimeters unless a type or external file format explicitly says otherwise.
- `packages/core/src/types.ts` is authoritative for persisted and shared shapes.
- `packages/core/src/defaults.ts` is the single source of truth for the default panel catalog, accessory rules, BOM labels, and customer-calibrated constants.
- Preserve `Project.schemaVersion` and the migration path when changing persisted data. Old saved projects must be handled deliberately.
- `Project.layout` and `Project.placements` are one computed result and must not drift apart.
- `Project.overrides` is user-entered data and must survive recomputation unless the user explicitly resets it.
- A corner panel can emit two placement legs with one `groupId`; count the physical unit once.
- `Placement.side` (`faceA`/`faceB`) and `faceIsInterior` are separate concepts. Never infer one from the other.
- Two paired contours can represent one physical wall. `consumedWallIds` must not be tiled again.
- Wall outward direction is derived from topology, not drag direction.
- A wall's `pairedWallId` must be invalidated when either partner's geometry stops matching.
- A straight join is not a corner. Do not introduce phantom corner panels or clamps.
- The current middle rule and customer verification case must remain covered: a 340 cm clear run resolves to `R75, R75, R40, R75, R75` when the applicable catalog and inventory permit it.
- Missing inventory remains visible as flagged placements/diagnostics; do not silently drop required physical units.
- Do not convert an item in `docs/open-questions.md` into an implemented rule without an explicit customer/user decision.
- Hebrew diagnostic messages and BOM labels are user/customer-facing data. Preserve valid UTF-8 and exact Priority labels where required.

For changes involving contour pairing, corner ownership, face runs, Dywidag alignment, clamps, inventory allocation, or BOM totals, read the relevant neighboring modules and tests as a pipeline. Local correctness in one function is not sufficient.

---

## 3. Multi-agent workflow

Use a lead-orchestrator workflow whenever the user asks for agents/sub-agents/parallel work, and by default for meaningful implementation that contains at least two independent workstreams. Tiny documentation edits, one-file mechanical fixes, and read-only answers may stay with the lead alone.

The orchestrator/executor model mapping is mandatory:

| Environment | Orchestrator | Execution sub-agents |
|---|---|---|
| ChatGPT / Codex | **SOL** (`gpt-5.6-sol`) | **TERRA** (`gpt-5.6-terra`) |
| Claude Code | **OPUS** | **SONNET** |

These are distinct responsibilities, not interchangeable model preferences:

- **SOL or OPUS is the orchestrator.** It reads the full context, plans the work, resolves dependencies, assigns file ownership, protects approval gates, reviews all diffs, integrates, performs final QA, and writes the final answer.
- **TERRA or SONNET agents are the executors.** They inspect and implement narrowly assigned tasks, add or update focused tests, run the assigned checks, and return a structured report to the orchestrator.
- Every code-writing, test-writing, review, or research sub-agent uses the executor model for its environment: TERRA in ChatGPT/Codex and SONNET in Claude Code.
- Executors do not take over orchestration, redefine product scope, approve engineering assumptions, edit unassigned shared files, or issue the final handoff.
- The orchestrator may implement high-conflict integration work itself, but should delegate independent implementation work to executors.
- Do not silently substitute another model for either role. If the required model is unavailable, state that limitation before continuing with a different setup.

Do not pause merely to recommend a model when the correct mapping is available. Start with the mapped orchestrator and executor roles unless the user must first make a product or engineering decision.

### 3.1 Lead orchestrator responsibilities

The lead owns the result end to end:

1. Inspect the working tree, relevant docs, code, and tests.
2. Identify dependencies, approval gates, unresolved domain questions, and high-conflict files.
3. Split work by independent responsibility, not by arbitrary file count.
4. Give each sub-agent a narrow, non-overlapping write scope.
5. Keep shared contracts and integration points under one owner.
6. Review every actual diff; do not accept a summary as proof.
7. Integrate the pieces, run focused and repository-level checks, and perform behavioral QA.
8. Fix or return incomplete work to the responsible agent, then review again.
9. Provide the final consolidated report. Sub-agent reports are never the final answer.

### 3.2 Executor responsibilities

Each TERRA/SONNET executor owns one bounded deliverable. It must:

1. Read the assigned context, relevant code, and neighboring tests before editing.
2. Stay inside its allowed file list and preserve all unrelated user/agent changes.
3. Implement the complete assigned slice rather than leaving unwired helpers or placeholders.
4. Add or update meaningful focused tests for its slice.
5. Run the checks named in its assignment and record exact results.
6. Inspect its own diff before reporting completion.
7. Report assumptions, risks, public-contract or migration impact, and anything the orchestrator must integrate.
8. Stop and report instead of guessing when it encounters an approval gate, conflicting evidence, or a required scope expansion.

An executor must not:

- expand the task or make an unresolved customer/engineering decision;
- modify files outside its write scope, even if another change looks useful;
- delegate its task again unless the orchestrator explicitly authorizes nested delegation;
- commit, push, deploy, or edit remote resources;
- claim the overall task is complete.

The orchestrator sends implementation defects back to a TERRA/SONNET executor with a focused correction request. After the correction, the orchestrator reviews the new diff and reruns the relevant QA; an executor's self-review never replaces this gate.

### 3.3 Recommended executor decomposition

Choose only the roles the task needs:

- **Core/geometry agent:** pure engine logic and focused core tests.
- **Web/canvas agent:** React state, Konva rendering/interactions, panels, browser import/export, and web tests.
- **Server/storage agent:** Fastify routes, validation, auth, persistence, and server tests.
- **QA/review agent:** read-only adversarial review against the approved plan, open questions, invariants, and regression scenarios.
- **Reference-analysis agent:** read-only extraction from customer drawings/files; reports observations and uncertainty, but does not decide engineering rules.

All of these subordinate roles use TERRA in ChatGPT/Codex or SONNET in Claude Code. The role name describes the assignment, not a different model.

Do not create agents just to satisfy a number. Parallelize only work that can proceed independently. If work is sequential, hand it off sequentially. For a multi-agent implementation, the normal sequence is:

1. SOL/OPUS inspects and produces the dependency-aware task split.
2. SOL/OPUS starts the required TERRA/SONNET executors with non-overlapping scopes.
3. Executors work in parallel only where their files and dependencies are independent.
4. SOL/OPUS reads every executor report and actual diff, then integrates shared contracts and cross-package wiring.
5. SOL/OPUS returns defects to the appropriate executor, reviews the correction, and owns final scenario QA.

### 3.4 Every executor prompt must include

- task name or ID;
- exact goal and definition of done;
- approved scope and relevant decision/plan references;
- files it may edit;
- files it must not edit;
- tests or checks it must run;
- domain invariants that apply;
- known risks and unresolved questions;
- expected report format;
- instruction to stop and report if the evidence conflicts or the scope must expand.

Every executor must report:

- what changed and why;
- files touched;
- tests/checks run and exact results;
- assumptions and deviations;
- remaining risks;
- documentation, migration, or public-contract impact.

### 3.5 Shared-worktree and conflict safety

All agents share one working tree.

- Run `git status --short` before assignment and again before integration.
- Existing changes belong to the user unless proven otherwise.
- Never overwrite, revert, format away, or fold unrelated changes into the task.
- Do not assign the same writable file to two agents at once.
- Agents may inspect files owned by another agent, but only the assigned owner edits them.
- If two tasks need the same shared file, make one agent the owner or have agents return proposals while the lead integrates.
- Review diffs by file and by behavior before accepting them.

High-conflict integration points include:

- `packages/core/src/types.ts`
- `packages/core/src/defaults.ts`
- `packages/core/src/index.ts`
- `packages/core/src/corners/tileProject.ts`
- `packages/web/src/state/ProjectContext.tsx`
- `packages/web/src/state/project.ts`
- `packages/web/src/canvas/Canvas.tsx`
- `packages/web/src/App.tsx`
- package manifests, `pnpm-lock.yaml`, workspace/config files, and migrations
- `CONTEXT.md`, `docs/open-questions.md`, and active plan documents

The lead should normally own edits to public types, default rules, migrations, shared exports, lockfiles, and plan/decision documents.

---

## 4. Implementation rules

- Use strict TypeScript; do not suppress errors with `any`, broad casts, `@ts-ignore`, or weakened compiler options.
- Prefer an existing abstraction and naming pattern before adding a new one.
- Keep domain names in English (`pour`, `wall`, `placement`, `dywidag`) and user-facing Hebrew in UI/diagnostic strings.
- Comments explain non-obvious reasons, engineering evidence, or constraints—not line-by-line behavior.
- Do not change engineering constants merely to make a test pass.
- Do not make a visual-only patch for incorrect geometry. Fix the owning calculation layer, then verify the canvas.
- Do not duplicate core calculations in React components or server routes.
- Do not derive export totals separately from the same quantities shown in the UI; use shared core sources.
- New or changed public exports must be deliberate and routed through the appropriate package index.
- Add a migration and migration tests when a persisted `Project` shape changes.
- Preserve stable IDs and `groupId` semantics when recomputing placements.
- Handle empty, invalid, degenerate, ambiguous, and partially stocked inputs explicitly with safe results or diagnostics.
- Do not add dependencies without a concrete need. If dependencies change, update the lockfile with pnpm.
- Do not commit, push, deploy, or modify remote resources unless the user explicitly asks.

### Approval gates

Respect every explicit approval gate in an active plan. For `docs/plan-parallel-formwork.md`, only the currently approved stage may be executed. Do not begin later implementation stages because they are described in the document.

If the current approved stage is analysis-only, do not edit production code. Return the requested observations/table and wait for approval.

Update a plan or `docs/open-questions.md` only when the task produces a user-approved decision or materially changes the documented implementation truth. Never mark a customer question resolved based solely on agent inference.

---

## 5. QA and review after sub-agents

The lead must independently verify sub-agent work. “Tests pass” is one signal, not completion.

### 5.1 Mandatory diff review

For every changed file, answer:

- Why did this file need to change?
- Is it within the assigned and user-approved scope?
- Are there unintended formatting or unrelated edits?
- Does the implementation fit the existing package boundary and architecture?
- Did a shared type, migration, export, ID, or persisted-data contract change?
- Did the change duplicate an existing calculation or create two sources of truth?
- Could the change alter quantities, physical placement, diagnostics, or customer exports outside the intended case?

Review especially carefully any change to contour resolution, face runs, panel selection, corner placement, inventory consumption, accessory counts, migration, project state, or export generation.

### 5.2 Test quality

Tests must prove behavior, not merely execute code.

- Add focused regression tests for changed engineering behavior.
- Assert exact geometry/placement/count outputs when the rule is exact.
- Cover negative and ambiguous inputs when relevant.
- Cover both sides of paired walls and mixed thicknesses when relevant.
- Cover inventory shortage and unlimited/legacy inventory behavior when relevant.
- Cover persistence/migration round trips when stored shapes change.
- For web changes, test state transitions and the handler wiring—not only component rendering.
- A regression test should fail if the old bug or wrong handler is restored.

Do not rewrite unrelated expected values to force green tests. Investigate why they changed.

### 5.3 Behavioral QA by area

For core geometry/tiling changes, check the applicable scenarios:

- single-line wall and two-contour wall;
- simple closed room and multiple/nested regions;
- inner/outer corners, straight joins, free ends, T-junctions, and crossings;
- different wall thicknesses and hand-drawn tolerances;
- face coverage with no unintended gap or duplicate tiling;
- corner physical-unit grouping;
- finite inventory, missing items, timber gaps, and diagnostics;
- per-pour and project-wide accessory/BOM totals;
- the canonical 340 cm middle-rule case.

For web/canvas changes, check the full affected user path: create/load project, draw/select/edit/delete, thickness entry, recompute, pour assignment, zoom/pan if touched, diagnostics, quantities/overrides, inventory import, save/reload, and export as applicable. Confirm that rendered geometry comes from the current computed layout.

For server/storage changes, check validation, not-found and malformed input, auth boundaries, list/load/save/duplicate/remove semantics, ownership/data isolation if introduced, atomic project persistence, and browser-provider compatibility.

### 5.4 Commands

Run the narrowest relevant tests during implementation, then the appropriate repository checks before handoff:

```bash
pnpm --filter @rastoplan/core test
pnpm --filter @rastoplan/web test
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Use only the checks relevant to the change, but for cross-package changes normally run the full `test`, `typecheck`, `lint`, and `build` set. If a command cannot run or a package has no meaningful tests, report that explicitly; do not describe it as passing coverage.

After QA, run `git status --short` and inspect the final diff. Confirm that pre-existing user changes remain intact.

---

## 6. Definition of done and final report

Work is done only when:

- the approved scope is fully implemented or the requested analysis is complete;
- the lead reviewed the actual code/diff and all sub-agent outputs;
- applicable engineering invariants and approval gates are satisfied;
- relevant focused tests pass;
- applicable typecheck, lint, and build checks pass;
- persisted data and migrations are accounted for;
- user/customer reference files and unrelated changes are untouched;
- remaining uncertainty is named clearly instead of hidden in an assumption.

The final response must state:

- outcome and approved scope completed;
- files changed;
- sub-agents/model roles used and each assignment, if any;
- what the lead independently reviewed and verified;
- scenarios checked;
- tests, typecheck, lint, and build results;
- documentation/migration impact;
- local uncommitted status or commit SHA, if the user requested a commit;
- remaining risks, unresolved customer questions, or follow-ups.

Never present a sub-agent's summary as the final result before lead integration and QA.
