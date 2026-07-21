import type { Placement, Project } from "../types.js";
import { buildGraph } from "../geometry/buildGraph.js";
import { classifyNodes } from "../geometry/classifyNodes.js";
import { classifyCornerSides } from "../geometry/classifyCornerSides.js";
import { tileWall } from "../tiling/tileWall.js";
import { placeCornerPanels } from "./placeCornerPanels.js";
import { syncOuterPlacements } from "./syncOuterPlacements.js";

/**
 * Runs the full corners+tiling pipeline for a project and returns the
 * complete Placement set (inner + outer + corners), marked with `side` and
 * `kind` so downstream layers can filter/render them.
 *
 * Pipeline:
 *   1. buildGraph → classifyNodes → classifyCornerSides.
 *   2. placeCornerPanels: emits C30x30 at inner corners, 10cm protrusion
 *      markers at outer corners, and returns edges with clearLength
 *      recomputed for the real corner rules (not computeClearLengths's
 *      placeholder).
 *   3. For each edge: tileWall(clearLength) → straight-run inner placements.
 *   4. syncOuterPlacements: mirrors inner corner panels + straight inner
 *      tiling onto the outer face at identical offsets (Dywidag alignment).
 *      Outer-only protrusion markers are appended separately (no inner
 *      counterpart).
 *
 * The step-2 clearLength recompute is why we don't call computeClearLengths
 * inside this pipeline — it would apply the placeholder deduction the
 * corners layer is precisely replacing.
 */
export function tileProject(project: Project): Placement[] {
  const { walls, catalog, rules } = project;
  const wallById = new Map(walls.map((w) => [w.id, w]));

  const { nodes: rawNodes, edges: rawEdges } = buildGraph(walls);
  const typedNodes = classifyNodes(rawNodes, rawEdges);
  const classifiedNodes = classifyCornerSides(typedNodes, rawEdges);

  const corners = placeCornerPanels(classifiedNodes, rawEdges, walls, catalog, rules);

  const allPlacements: Placement[] = [];
  for (const edge of corners.edges) {
    const wall = wallById.get(edge.wallId);
    if (!wall) continue;

    // Every inner-side placement on this edge, in one bucket, so sync
    // produces a matching outer-side placement for each and Dywidag
    // alignment holds for both the C30x30 corners and the straight tiles.
    const innerCorners = corners.innerCornerPanels.filter((p) => p.edgeId === edge.id);
    const innerTiles = tileWall(edge, wall.pourId, catalog, rules);
    const innerSide = [...innerCorners, ...innerTiles];

    const outerSide = syncOuterPlacements(innerSide);

    const outerProtrusions = corners.outerCornerProtrusions.filter((p) => p.edgeId === edge.id);

    allPlacements.push(...innerSide, ...outerSide, ...outerProtrusions);
  }

  return allPlacements;
}
