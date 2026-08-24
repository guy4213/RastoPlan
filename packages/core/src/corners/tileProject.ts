import type { Placement, Project, ProjectLayout, RegionSummary } from "../types.js";
import { resolveWalls } from "../contours/resolveWalls.js";
import type { ResolveOptions } from "../contours/constants.js";
import { tileWall } from "../tiling/tileWall.js";
import { placeCornerPanels } from "./placeCornerPanels.js";

/** Bump when a change makes previously saved layouts wrong rather than merely stale. */
/**
 * Stamped into every layout so a stored one can be told apart from what the
 * current engine would produce. Bump it whenever a change makes old layouts
 * wrong rather than merely different — the web app drops mismatched layouts on
 * load and asks for a recompute.
 *
 * 3: thin walls pair (the 15cm floor became technical), thickness is measured
 *    off the drawing, and outer corners are lapped joints instead of butted.
 * 4: the lap direction was finalised: horizontal panels carry the full 10cm;
 *    vertical panels are inset 2cm at the top and bottom. Version 3 existed
 *    while that corner rule was still being tuned, so its stored placements
 *    must not survive and keep showing a square 10x10 overlap.
 * 5: corner-lap centimetres moved out of tileable run lengths and into the
 *    canvas-only drawing copies. Version 4 can contain artificial 8cm timber
 *    fillers and wrong accessory counts, so every such layout is recomputed.
 */
export const ENGINE_VERSION = 5;

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
    const runs = corners.runs.get(edge?.id ?? "");
    if (!edge || !runs) continue;

    // Each face on its own run — see tileWall. The outer ring of a room carries
    // more panels than the inner ring, which is what the customer's plans show.
    const faces = resolvedWall.faces.map((face) =>
      tileWall(
        edge,
        {
          wallId: resolvedWall.id,
          pourId: resolvedWall.pourId,
          side: face.id,
          faceIsInterior: face.isInterior,
          clearLength: runs[face.id].clearLength,
          startOffset: runs[face.id].startOffset,
        },
        catalog,
        rules
      )
    );

    placements.push(
      ...corners.cornerPanels.filter((p) => p.edgeId === edge.id),
      ...faces.flat(),
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
    regions: resolution.regions.map((r): RegionSummary => ({
      id: r.id,
      kind: r.kind,
      area: r.area,
    })),
    corners: resolution.corners,
    diagnostics,
    engineVersion: ENGINE_VERSION,
  };

  return { placements, layout };
}

/** Back-compat shim for callers that only want the placements. */
export function tileProjectPlacements(project: Project, options: ResolveOptions = {}): Placement[] {
  return tileProject(project, options).placements;
}
