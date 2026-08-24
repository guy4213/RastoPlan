import type { Placement, Project } from "../types.js";
import { DEFAULT_ACCESSORY_RULES } from "../defaults.js";

export const CURRENT_SCHEMA_VERSION = 3;

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
  return migrated;
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
