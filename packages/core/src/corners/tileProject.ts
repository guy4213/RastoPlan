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
 *   2. placeCornerPanels: emits a C30x30 on the inner face at every L corner,
 *      overlap markers at outer corners, and returns edges with clearLength
 *      recomputed for the real corner rules (not computeClearLengths's
 *      placeholder).
 *   3. For each edge: tileWall(clearLength) → straight-run inner placements.
 *   4. syncOuterPlacements: mirrors the straight inner tiling onto the outer
 *      face at identical offsets (Dywidag alignment). Corner panels stay
 *      inner-only and outer-only overlap markers are appended separately.
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

    // Only the straight run is mirrored: the outer face carries straight
    // panels plus an overlap at the corner, never a corner panel. Dywidag
    // alignment is asserted over that shared straight run.
    const innerCorners = corners.innerCornerPanels.filter((p) => p.edgeId === edge.id);
    const innerTiles = tileWall(edge, wall.pourId, catalog, rules);

    const outerSide = syncOuterPlacements(innerTiles);

    const outerProtrusions = corners.outerCornerProtrusions.filter((p) => p.edgeId === edge.id);

    allPlacements.push(...innerCorners, ...innerTiles, ...outerSide, ...outerProtrusions);
  }

  return allPlacements;
}
