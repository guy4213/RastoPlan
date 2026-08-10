import type { Placement, Project, ProjectLayout, RegionSummary } from "../types.js";
import { resolveWalls } from "../contours/resolveWalls.js";
import type { ResolveOptions } from "../contours/constants.js";
import { tileWall } from "../tiling/tileWall.js";
import { placeCornerPanels } from "./placeCornerPanels.js";
import { syncFacePlacements } from "./syncFacePlacements.js";

/** Bump when a change makes previously saved layouts wrong rather than merely stale. */
export const ENGINE_VERSION = 2;

export interface TileProjectResult {
  placements: Placement[];
  layout: ProjectLayout;
}

/**
 * Runs the full contours+corners+tiling pipeline and returns the complete
 * placement set plus the derived layout.
 *
 * Pipeline:
 *   1. resolveWalls: face traversal → regions → contour pairing. Decides what
 *      is a room, what is wall material, which way is out, and which drawn
 *      walls were only the far face of another wall.
 *   2. placeCornerPanels: a corner panel per room per corner, on the face that
 *      borders that room; overlap strips only on faces that border no room.
 *   3. Per resolved wall: tileWall on face A, mirrored onto face B at identical
 *      offsets for Dywidag alignment.
 *
 * Consumed walls are never tiled — that is what stops a plan traced as two
 * rectangles from producing two independent, doubled-up wall sets.
 */
export function tileProject(project: Project, options: ResolveOptions = {}): TileProjectResult {
  const { walls, catalog, rules } = project;

  const resolution = resolveWalls(walls, options);
  const corners = placeCornerPanels({ resolution, walls, catalog, rules });

  const edgeById = new Map(corners.edges.map((e) => [e.id, e]));
  const placements: Placement[] = [];
  const diagnostics = [...resolution.diagnostics];

  for (const resolvedWall of resolution.resolvedWalls) {
    const edge = edgeById.get(`edge:${resolvedWall.id}`);
    if (!edge) continue;

    const [faceA, faceB] = resolvedWall.faces;
    const tiles = tileWall(
      edge,
      {
        wallId: resolvedWall.id,
        pourId: resolvedWall.pourId,
        side: faceA.id,
        faceIsInterior: faceA.isInterior,
      },
      catalog,
      rules
    );

    placements.push(
      ...corners.cornerPanels.filter((p) => p.edgeId === edge.id),
      ...tiles,
      ...syncFacePlacements(tiles, faceB.id, faceB.isInterior),
      ...corners.protrusions.filter((p) => p.edgeId === edge.id)
    );
  }

  const layout: ProjectLayout = {
    nodes: resolution.nodes,
    // Consumed edges are dropped: every accessory counter reads this list as
    // "walls that need formwork", and a wall that was only the far face of
    // another one would otherwise be counted a second time for struts.
    edges: corners.edges.filter((e) => resolution.wallByEdgeId.has(e.id)),
    resolvedWalls: resolution.resolvedWalls,
    regions: resolution.regions.map(
      (r): RegionSummary => ({ id: r.id, kind: r.kind, area: r.area })
    ),
    corners: resolution.corners,
    diagnostics,
    engineVersion: ENGINE_VERSION,
  };

  return { placements, layout };
}

/** Back-compat shim for callers that only want the placements. */
export function tileProjectPlacements(
  project: Project,
  options: ResolveOptions = {}
): Placement[] {
  return tileProject(project, options).placements;
}
