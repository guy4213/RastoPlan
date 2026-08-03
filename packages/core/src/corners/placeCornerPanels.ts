import type { AccessoryRules, Edge, Node, PanelCatalog, Placement, Wall } from "../types.js";
import { otherWallThicknessAt } from "../geometry/neighborThickness.js";
import { outerCornerProtrusionFor } from "./outerCornerProtrusion.js";

export interface PlaceCornerPanelsResult {
  /**
   * C30x30 placements at EVERY L corner, INNER face only.
   *
   * One physical corner panel wraps the corner, so it emits one leg on each
   * meeting wall; both legs carry the same `groupId` and must be counted once
   * (its BOM area, 1.8m², is both legs together). The outer face gets straight
   * panels plus an overlap instead — never a corner panel — which is why these
   * are deliberately not fed to syncOuterPlacements.
   */
  innerCornerPanels: Placement[];
  /**
   * Overlap strips at convex ('outer') L corners, OUTER face only, width per
   * `outerCornerProtrusionFor` (neighbour-thickness dependent). Emitted once
   * per (edge, outer-corner end); the two meeting walls therefore both carry
   * one, and picking which physical panel actually wraps is a downstream
   * drafting choice.
   */
  outerCornerProtrusions: Placement[];
  /**
   * Edges with clearLength recomputed for the real corner-consumption rules
   * (one corner-panel leg off each L-corner end, replacing computeClearLengths's
   * neighbor-thickness placeholder), and with T/cross/unresolved flags carried
   * through.
   */
  edges: Edge[];
}

/**
 * Places the corner-adjacent formwork per the corners layer's rules:
 * - every L corner: a corner panel (C30x30) on the inner face, because the
 *   inner formwork folds around the corner. Both concave and convex corners —
 *   they are not alternatives, which is what the customer corrected.
 * - convex ('outer') L corner additionally: on the outer face two straight
 *   panels meet with an overlap, so an overlap strip is emitted there.
 *
 * `offsetAlongEdge` on every returned Placement is expressed in the clear-run
 * frame (same frame tileWall uses): 0 to clearLength is the tileable straight
 * run, and corner-adjacent placements sit at negative offsets or offsets
 * ≥ clearLength — i.e., outside the clear run.
 */
export function placeCornerPanels(
  nodes: Node[],
  edges: Edge[],
  walls: Wall[],
  catalog: PanelCatalog,
  rules: AccessoryRules
): PlaceCornerPanelsResult {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const wallById = new Map(walls.map((w) => [w.id, w]));

  const cornerPanel = pickCornerPanel(catalog);
  const cornerPanelWidth = cornerPanel?.width ?? 30;
  const cornerPanelType = cornerPanel?.type ?? "C30x30";

  const innerCornerPanels: Placement[] = [];
  const outerCornerProtrusions: Placement[] = [];

  const adjustedEdges: Edge[] = edges.map((edge) => {
    const wall = wallById.get(edge.wallId);
    if (!wall) return edge;

    const [a, b] = wall.innerLine;
    const geometricLength = Math.hypot(b.x - a.x, b.y - a.y);

    const nodeA = nodeById.get(edge.nodeA);
    const nodeB = nodeById.get(edge.nodeB);

    let deduction = 0;
    const flags: string[] = [];

    for (const node of [nodeA, nodeB]) {
      if (!node) continue;
      if (node.type === "L") {
        deduction += cornerPanelWidth;
        if (node.cornerSide !== "inner" && node.cornerSide !== "outer") {
          flags.push("unresolved-corner-side");
        }
      } else if (node.type === "T") flags.push("unresolved-T");
      else if (node.type === "cross") flags.push("unresolved-cross");
    }

    const clearLength = Math.max(0, geometricLength - deduction);

    // Now that clearLength is known, emit corner-adjacent placements in the
    // clear-run frame (offsets < 0 or ≥ clearLength sit outside the run).
    const pourId = wall.pourId;
    for (const [node, end] of [
      [nodeA, "A"],
      [nodeB, "B"],
    ] as const) {
      if (node?.type !== "L") continue;

      innerCornerPanels.push({
        id: `placement:${edge.id}:corner:${end}`,
        // Both legs of one physical corner panel share the corner node.
        groupId: `corner:${node.id}`,
        edgeId: edge.id,
        pourId,
        side: "inner",
        kind: "corner-panel",
        panelType: cornerPanelType,
        offsetAlongEdge: end === "A" ? -cornerPanelWidth : clearLength,
        width: cornerPanelWidth,
        source: "auto",
        flags: [],
      });

      if (node.cornerSide !== "outer") continue;

      const protrusion = outerCornerProtrusionFor(
        otherWallThicknessAt(node.id, edge, edges, wallById),
        rules
      );
      outerCornerProtrusions.push({
        id: `placement:${edge.id}:protrusion:${end}`,
        edgeId: edge.id,
        pourId,
        side: "outer",
        kind: "panel",
        panelType: "",
        offsetAlongEdge: end === "A" ? -protrusion : clearLength,
        width: protrusion,
        source: "auto",
        flags: ["outer-corner-protrusion"],
      });
    }

    return { ...edge, clearLength, flags };
  });

  return { innerCornerPanels, outerCornerProtrusions, edges: adjustedEdges };
}

/**
 * The catalog stocks corner panels in several leg sizes (15/20/25/30). Auto
 * layout uses the customer's leading one; taking the first in-stock match
 * would silently pick C15x15 just because it sorts first.
 */
function pickCornerPanel(catalog: PanelCatalog) {
  const corners = catalog.panels.filter((p) => p.kind === "corner" && p.inStock);
  return corners.find((p) => p.isLeading) ?? corners[0];
}
