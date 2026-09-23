import type { Placement, Project } from "../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../defaults.js";

export const CURRENT_SCHEMA_VERSION = 5;

/** The timber-gap bounds every project shipped with before the 13/9/2026 narrowing. */
const LEGACY_TIMBER_GAP_MIN = 5;
const LEGACY_TIMBER_GAP_MAX = 9;

/** Thickness a wall drawn into a pour starts at, when the pour doesn't say. */
export const DEFAULT_POUR_THICKNESS_CM = 20;

/**
 * Brings a saved project up to the current schema, one step at a time.
 *
 * Written as a chain rather than a single early return on purpose: the previous
 * shape bailed out for anything already at the current version, so adding a
 * later step would have silently skipped every project saved under the version
 * before it — and a project missing a newly added AccessoryRules field computes
 * NaN clear lengths rather than failing loudly.
 *
 * Idempotent: a current project passes through untouched. Called at the single
 * choke point where projects are loaded, so nothing downstream sees an old shape.
 */
export function migrateProject(project: Project): Project {
  let migrated = project;
  if ((migrated.schemaVersion ?? 1) < 2) migrated = toV2(migrated);
  if ((migrated.schemaVersion ?? 1) < 3) migrated = toV3(migrated);
  if ((migrated.schemaVersion ?? 1) < 4) migrated = toV4(migrated);
  if ((migrated.schemaVersion ?? 1) < 5) migrated = toV5(migrated);
  return migrated;
}

/**
 * True when a project's stored gap bounds are still the pre-13/9/2026 defaults
 * (5–9cm), i.e. nobody ever wrote a different value into `Project.rules` for
 * it — there is no settings screen yet that could have done that, but the
 * field has always been a plain, save-able part of `AccessoryRules`. Safe on a
 * legacy blob that predates `rules` entirely (optional chaining, not a throw).
 */
function hasLegacyTimberGap(project: Project): boolean {
  return (
    project.rules?.timberGapMin === LEGACY_TIMBER_GAP_MIN &&
    project.rules?.timberGapMax === LEGACY_TIMBER_GAP_MAX
  );
}

/** True when the stored gap bounds already match the current (post-13/9/2026) default. */
function hasCurrentDefaultTimberGap(project: Project): boolean {
  return (
    project.rules?.timberGapMin === DEFAULT_ACCESSORY_RULES.timberGapMin &&
    project.rules?.timberGapMax === DEFAULT_ACCESSORY_RULES.timberGapMax
  );
}

/**
 * Whether loading THIS raw project through `migrateProject` will leave its
 * timber-gap bounds untouched because they are already something other than
 * the old 5–9cm default — i.e. a value this migration cannot safely assume is
 * meant to become 1–5cm. Exported so the caller (the web app's project-load
 * path) can surface that as a notice; `migrateProject` itself has no side
 * channel to report through, being a plain, pure `Project -> Project` step.
 *
 * A project with no `rules` at all (predates the field) is NOT customized —
 * migration fills it from scratch — and neither is one that already carries
 * the current 1–5cm default (nothing for this migration to preserve either
 * way), so only a third, genuinely different value counts.
 *
 * Checked on the version BEFORE migration: a project already at schema 5 is
 * reported as unaffected, since v5 is exactly the version this concerns.
 */
export function hasNonDefaultTimberGapBeforeMigration(rawProject: Project): boolean {
  if ((rawProject.schemaVersion ?? 1) >= 5) return false;
  if (!rawProject.rules) return false;
  return !hasLegacyTimberGap(rawProject) && !hasCurrentDefaultTimberGap(rawProject);
}

/**
 * v4 → v5: the timber-gap range narrows from 5–9cm to 1–5cm (customer
 * decision, 13/9/2026 — docs/open-questions.md §4). Every saved project whose
 * bounds are still the old default is carried to the new one, per that
 * decision — including one already computed under the old range, so the same
 * drawing behaves identically whether it was just opened for the first time
 * or has been open for months.
 *
 * A project whose gap bounds do NOT match the old default is left exactly as
 * saved: nothing today can have written a different value (no rules editor
 * exists yet), so this is future-proofing rather than an observed case — but
 * if one ever appears, silently overwriting a value nobody but this migration
 * would have set is the wrong failure mode. See
 * `hasNonDefaultTimberGapBeforeMigration`, checked by the caller separately,
 * for surfacing that case — this function has no side channel of its own.
 */
function toV5(project: Project): Project {
  if (!hasLegacyTimberGap(project)) return { ...project, schemaVersion: 5 };
  return {
    ...project,
    schemaVersion: 5,
    rules: {
      ...project.rules,
      timberGapMin: DEFAULT_ACCESSORY_RULES.timberGapMin,
      timberGapMax: DEFAULT_ACCESSORY_RULES.timberGapMax,
    },
  };
}

/**
 * v3 → v4: junction restrictions on the project's own catalog copy. The catalog
 * is stored per project, so a restriction added to the defaults (R90 → T only)
 * would never reach a saved project on its own. Each saved panel that has no
 * restriction takes the default catalog's restriction for the same `type`;
 * nothing else about the panel changes, and no panel id is ever touched.
 */
function toV4(project: Project): Project {
  const restrictionByType = new Map(
    DEFAULT_PANEL_CATALOG.panels
      .filter((panel) => panel.allowedAtNodeTypes)
      .map((panel) => [panel.type, panel.allowedAtNodeTypes!])
  );
  return {
    ...project,
    schemaVersion: 4,
    catalog: {
      ...project.catalog,
      panels: project.catalog.panels.map((panel) => {
        const restriction = restrictionByType.get(panel.type);
        return panel.allowedAtNodeTypes || !restriction
          ? panel
          : { ...panel, allowedAtNodeTypes: [...restriction] };
      }),
    },
  };
}

/**
 * v1 → v2: `Placement.side` was 'inner'/'outer', which conflated two different
 * questions — which face of the wall a panel sits on, and whether that face
 * borders a room. They are now `side` ('faceA'/'faceB') and `faceIsInterior`.
 * `wallId` is back-filled from the edge id, which is where every call site used
 * to dig it out with a regex.
 */
function toV2(project: Project): Project {
  return {
    ...project,
    schemaVersion: 2,
    placements: project.placements.map(migratePlacement),
    // The engine rewrites this on the next compute; a v1 project never had one.
    layout: undefined,
  };
}

/**
 * v2 → v3: fills in fields added with the wall-thickness work — any
 * AccessoryRules key the project predates, and each pour's default thickness.
 * Geometry is untouched: `walls`, `placements` and `layout` all pass through, so
 * loading an old project can't move anything on the canvas. `Wall.pairedWallId`
 * is deliberately left unset — only a compute can establish which two contours
 * are one wall, and guessing it here could move the wrong wall later.
 */
function toV3(project: Project): Project {
  return {
    ...project,
    schemaVersion: 3,
    rules: { ...DEFAULT_ACCESSORY_RULES, ...project.rules },
    pours: project.pours.map((pour) => ({
      ...pour,
      defaultThicknessCm: pour.defaultThicknessCm ?? DEFAULT_POUR_THICKNESS_CM,
    })),
  };
}

function migratePlacement(placement: Placement): Placement {
  const legacySide = placement.side as string;
  const side = legacySide === "outer" || legacySide === "faceB" ? "faceB" : "faceA";

  return {
    ...placement,
    side,
    wallId: placement.wallId ?? placement.edgeId.replace(/^edge:/, ""),
    faceIsInterior: placement.faceIsInterior ?? side === "faceA",
  };
}
