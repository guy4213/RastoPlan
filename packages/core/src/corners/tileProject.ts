import type { Placement, Project, ProjectLayout, RegionSummary } from "../types.js";
import { resolveWalls } from "../contours/resolveWalls.js";
import type { ResolveOptions } from "../contours/constants.js";
import { tileWall } from "../tiling/tileWall.js";
import { detectExternalCorners } from "../geometry/detectExternalCorners.js";
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
 * 6: imported finite inventory now constrains corner and straight-panel
 *    selection per pour. Version 5 layouts can contain panels unavailable in
 *    the project's saved inventory.
 * 7: partial inventory is placed unit-by-unit; only missing units are flagged
 *    instead of replacing an otherwise usable wall run with one red block.
 * 8: every resolved physical wall temporarily got only its primary row.
 * 9: clear outside K30 corners are derived from the current wall graph and
 *    stored in the layout instead of being seeded as fixture-only points.
 * 10: every DRAWN face gets exactly one row. A paired second contour is tiled;
 *     an undrawn face derived only from a thickness value is not.
 * 11: outside K30 corners follow the drawn exterior face of a paired wall,
 *     rather than the primary inner contour retained for tiling bookkeeping.
 */
export const ENGINE_VERSION = 11;

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
 *   3. Per resolved physical wall: tile every face that the user actually
 *      drew. A single line therefore gets one row; a paired inner+outer trace
 *      gets two rows total, one on each source line.
 *
 * Consumed walls are never tiled — that is what stops a plan traced as two
 * rectangles from producing two independent, doubled-up wall sets.
 */
export function tileProject(project: Project, options: ResolveOptions = {}): TileProjectResult {
  const { walls, catalog, rules } = project;

  const resolution = resolveWalls(walls, options);
  const availablePanelCountsByPour = inventoryLedger(project);
  const corners = placeCornerPanels({
    resolution,
    walls,
    catalog,
    rules,
    availablePanelCountsByPour,
  });

  const edgeById = new Map(corners.edges.map((e) => [e.id, e]));
  const placements: Placement[] = [];
  const diagnostics = [...resolution.diagnostics, ...corners.diagnostics];

  for (const resolvedWall of resolution.resolvedWalls) {
    const edge = edgeById.get(`edge:${resolvedWall.id}`);
    const runs = corners.runs.get(edge?.id ?? "");
    if (!edge || !runs) continue;

    // One panel row per DRAWN face. faceA is always the primary source line.
    // faceB is included only when it came from a real paired contour; an
    // unpaired wall's thickness-derived face must not manufacture another row.
    const faces: Placement[][] = [];
    const drawnFaces = resolvedWall.faces.filter(
      (face) => face.id === "faceA" || face.sourceWallId !== undefined
    );
    for (const face of drawnFaces) {
      const availability = availablePanelCountsByPour?.[resolvedWall.pourId];
      const tiled = tileWall(
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
        rules,
        availability
      );
      consumeStraightPanels(tiled, availability);
      const missing = missingPanelCounts(tiled);
      if (Object.keys(missing).length > 0) {
        diagnostics.push({
          code: "inventory-straight-panel-shortage",
          severity: "error",
          message: `חסרים במלאי למקטע זה: ${Object.entries(missing)
            .map(([type, count]) => `${type} × ${count}`)
            .join(", ")}`,
          wallIds: [resolvedWall.id],
          nodeIds: [edge.nodeA, edge.nodeB],
        });
      }
      faces.push(tiled);
    }

    placements.push(
      ...corners.cornerPanels.filter((p) => p.edgeId === edge.id),
      ...faces.flat(),
      ...corners.protrusions.filter((p) => p.edgeId === edge.id)
    );
  }

  const activeEdges = corners.edges.filter((edge) => resolution.wallByEdgeId.has(edge.id));
  const exteriorSourceWallIds = new Set(
    resolution.resolvedWalls.map((resolvedWall) => {
      const drawnExteriorFace = resolvedWall.faces.find(
        (face) => !face.isInterior && face.sourceWallId !== undefined
      );
      return drawnExteriorFace?.sourceWallId ?? resolvedWall.sourceWallId;
    })
  );
  const exteriorEdges = corners.edges.filter((edge) =>
    exteriorSourceWallIds.has(edge.wallId)
  );
  const layout: ProjectLayout = {
    nodes: resolution.nodes,
    // Consumed edges are dropped: every accessory counter reads this list as
    // "walls that need formwork", and a wall that was only the far face of
    // another one would otherwise be counted a second time for struts.
    edges: activeEdges,
    resolvedWalls: resolution.resolvedWalls,
    regions: resolution.regions.map((r): RegionSummary => ({
      id: r.id,
      kind: r.kind,
      area: r.area,
    })),
    corners: resolution.corners,
    externalCorners: detectExternalCorners(resolution.nodes, exteriorEdges, walls),
    diagnostics,
    engineVersion: ENGINE_VERSION,
  };

  return { placements, layout };
}

/** One independent stock ledger per pour: the same equipment is reused later. */
function inventoryLedger(
  project: Project
): Record<string, Record<string, number>> | undefined {
  if (!project.inventory) return undefined;
  const baseline = Object.fromEntries(
    project.catalog.panels.map((panel) => [
      panel.type,
      Math.max(0, Math.floor(project.inventory?.[panel.bomLabel] ?? 0)),
    ])
  );
  return Object.fromEntries(project.pours.map((pour) => [pour.id, { ...baseline }]));
}

function consumeStraightPanels(
  placements: Placement[],
  availability: Record<string, number> | undefined
): void {
  if (!availability) return;
  for (const placement of placements) {
    if (
      placement.kind !== "panel" ||
      !placement.panelType ||
      placement.flags.includes("inventory-shortage")
    )
      continue;
    availability[placement.panelType] = Math.max(
      0,
      (availability[placement.panelType] ?? 0) - 1
    );
  }
}

function missingPanelCounts(placements: Placement[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const placement of placements) {
    if (!placement.flags.includes("inventory-shortage") || !placement.panelType) continue;
    counts[placement.panelType] = (counts[placement.panelType] ?? 0) + 1;
  }
  return counts;
}

/** Back-compat shim for callers that only want the placements. */
export function tileProjectPlacements(project: Project, options: ResolveOptions = {}): Placement[] {
  return tileProject(project, options).placements;
}
