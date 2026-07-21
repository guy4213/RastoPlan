import type { AccessoryRules, Edge, Node, PanelCatalog, Placement, Wall } from "../types.js";

export interface PlaceCornerPanelsResult {
  /**
   * C30x30 placements at concave ('inner') L corners, INNER face only.
   * The outer-face copies are produced later by syncOuterPlacements — this
   * keeps the Dywidag invariant that inner and outer share offsets exactly.
   * (Design note flagged in the session summary: at a concave inner corner
   * the outer face is convex from outside, so a domain expert may later
   * choose to swap these outer-side copies for straight+protrusion instead.
   * That would break inner/outer offset sync at the corner and must be an
   * explicit tradeoff, not a silent one.)
   */
  innerCornerPanels: Placement[];
  /**
   * 10cm protrusion strips at convex ('outer') L corners, OUTER face only.
   * These have no inner-face counterpart — the inner face terminates
   * cleanly at the corner node while the outer face wraps past it. Emitted
   * once per (edge, outer-corner end); the two meeting walls therefore both
   * carry one, and picking which physical panel actually wraps is a
   * downstream drafting choice.
   */
  outerCornerProtrusions: Placement[];
  /**
   * Edges with clearLength recomputed for the real corner-consumption rules
   * (30cm off each inner-corner side, 0cm off each outer-corner side —
   * replacing computeClearLengths's neighbor-thickness placeholder), and
   * with T/cross/unresolved-corner-side flags carried through.
   */
  edges: Edge[];
}

/**
 * Places the corner-adjacent formwork per the corners layer's rules:
 * - inner (concave) L corner: C30x30 corner panel on each meeting wall's
 *   inner face; the outer face is handled later by sync.
 * - outer (convex) L corner: no corner panel; the outer face gets a 10cm
 *   protrusion strip on each meeting wall (rules.outerCornerProtrusionCm),
 *   and the inner-face straight tiling runs the full inner-line length.
 *
 * Also emits an adjusted Edge[] whose clearLength reflects the corner
 * deductions actually used here — replacing the placeholder deduction from
 * computeClearLengths (which pessimistically subtracted the neighbor's
 * thickness at outer corners to prevent overlap).
 *
 * `offsetAlongEdge` on every returned Placement is expressed in the
 * clear-run frame (same frame tileWall uses): 0 to clearLength is the
 * tileable straight run, and corner-adjacent placements sit at negative
 * offsets or offsets ≥ clearLength — i.e., outside the clear run.
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

  const cornerPanel = catalog.panels.find((p) => p.kind === "corner" && p.inStock);
  const cornerPanelWidth = cornerPanel?.width ?? 30;
  const cornerPanelType = cornerPanel?.type ?? "C30x30";
  const protrusion = rules.outerCornerProtrusionCm;

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
        if (node.cornerSide === "inner") deduction += cornerPanelWidth;
        else if (node.cornerSide !== "outer") flags.push("unresolved-corner-side");
      } else if (node.type === "T") flags.push("unresolved-T");
      else if (node.type === "cross") flags.push("unresolved-cross");
    }

    const clearLength = Math.max(0, geometricLength - deduction);

    // Now that clearLength is known, emit corner-adjacent placements in the
    // clear-run frame (offsets < 0 or ≥ clearLength sit outside the run).
    const pourId = wall.pourId;
    if (nodeA?.type === "L" && nodeA.cornerSide === "inner") {
      innerCornerPanels.push({
        id: `placement:${edge.id}:corner:A`,
        edgeId: edge.id,
        pourId,
        side: "inner",
        kind: "corner-panel",
        panelType: cornerPanelType,
        offsetAlongEdge: -cornerPanelWidth,
        width: cornerPanelWidth,
        source: "auto",
        flags: [],
      });
    }
    if (nodeB?.type === "L" && nodeB.cornerSide === "inner") {
      innerCornerPanels.push({
        id: `placement:${edge.id}:corner:B`,
        edgeId: edge.id,
        pourId,
        side: "inner",
        kind: "corner-panel",
        panelType: cornerPanelType,
        offsetAlongEdge: clearLength,
        width: cornerPanelWidth,
        source: "auto",
        flags: [],
      });
    }
    if (nodeA?.type === "L" && nodeA.cornerSide === "outer") {
      outerCornerProtrusions.push({
        id: `placement:${edge.id}:protrusion:A`,
        edgeId: edge.id,
        pourId,
        side: "outer",
        kind: "panel",
        panelType: "",
        offsetAlongEdge: -protrusion,
        width: protrusion,
        source: "auto",
        flags: ["outer-corner-protrusion"],
      });
    }
    if (nodeB?.type === "L" && nodeB.cornerSide === "outer") {
      outerCornerProtrusions.push({
        id: `placement:${edge.id}:protrusion:B`,
        edgeId: edge.id,
        pourId,
        side: "outer",
        kind: "panel",
        panelType: "",
        offsetAlongEdge: clearLength,
        width: protrusion,
        source: "auto",
        flags: ["outer-corner-protrusion"],
      });
    }

    return { ...edge, clearLength, flags };
  });

  return { innerCornerPanels, outerCornerProtrusions, edges: adjustedEdges };
}
