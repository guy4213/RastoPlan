import type { Placement, Project } from "../types.js";

export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Brings a saved project up to the current schema.
 *
 * v1 → v2: `Placement.side` was 'inner'/'outer', which conflated two different
 * questions — which face of the wall a panel sits on, and whether that face
 * borders a room. They are now `side` ('faceA'/'faceB') and `faceIsInterior`.
 * `wallId` is back-filled from the edge id, which is where every call site used
 * to dig it out with a regex.
 *
 * Idempotent: a v2 project passes through untouched. Called at the single
 * choke point where projects are loaded, so nothing downstream sees v1 shapes.
 */
export function migrateProject(project: Project): Project {
  if ((project.schemaVersion ?? 1) >= CURRENT_SCHEMA_VERSION) return project;

  return {
    ...project,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    placements: project.placements.map(migratePlacement),
    // The engine rewrites this on the next compute; a v1 project never had one.
    layout: undefined,
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
