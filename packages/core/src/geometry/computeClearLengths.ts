import type { Edge, Node, Wall } from "../types.js";
import { otherWallThicknessAt } from "./neighborThickness.js";

export interface ComputeClearLengthsOptions {
  /** width in cm consumed from each edge entering an inner (concave) L corner — the corner panel's leg length (DEFAULT_PANEL_CATALOG's C30x30 -> 30). */
  cornerPanelWidth: number;
}

/**
 * Deducts corner regions from each Edge's raw geometric length:
 * - inner (concave) L corner: `cornerPanelWidth` off each edge that meets
 *   there — the corner panel's leg occupies that much of both runs.
 * - outer (convex) L corner: the *other* wall's thickness off this edge —
 *   a placeholder so the two walls' clear runs don't overlap in the shared
 *   corner region (exact accessory-level handling belongs to the panel
 *   layer, Milestone 2 layer 3).
 * - T/cross: no automatic deduction — the edge is flagged 'unresolved-T' /
 *   'unresolved-cross' for manual handling instead.
 * - 'L' nodes that classifyCornerSides couldn't resolve (open chains):
 *   no deduction, flagged 'unresolved-corner-side' so it isn't silently
 *   treated as a plain, uneventful wall end.
 */
export function computeClearLengths(
  nodes: Node[],
  edges: Edge[],
  walls: Wall[],
  options: ComputeClearLengthsOptions
): Edge[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const wallById = new Map(walls.map((w) => [w.id, w]));

  return edges.map((edge) => {
    let deduction = 0;
    const flags: string[] = [];

    for (const nodeId of [edge.nodeA, edge.nodeB]) {
      const node = nodeById.get(nodeId);
      if (!node) continue;

      if (node.type === "L") {
        if (node.cornerSide === "inner") {
          deduction += options.cornerPanelWidth;
        } else if (node.cornerSide === "outer") {
          deduction += otherWallThicknessAt(node.id, edge, edges, wallById);
        } else {
          flags.push("unresolved-corner-side");
        }
      } else if (node.type === "T") {
        flags.push("unresolved-T");
      } else if (node.type === "cross") {
        flags.push("unresolved-cross");
      }
      // 'end' nodes: open end of a wall run, no deduction.
    }

    return {
      ...edge,
      clearLength: Math.max(0, edge.clearLength - deduction),
      flags,
    };
  });
}
