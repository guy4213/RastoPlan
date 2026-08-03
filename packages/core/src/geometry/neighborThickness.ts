import type { Edge, Wall } from "../types.js";

/**
 * Thickness of the OTHER wall meeting `edge` at `nodeId`.
 *
 * At a corner the two walls' formwork interacts, so several rules (clear-run
 * deduction, outer-corner overlap) need the neighbour's thickness rather than
 * this wall's own. Returns 0 when the node has no second incident edge —
 * an open wall end has no neighbour to account for.
 */
export function otherWallThicknessAt(
  nodeId: string,
  edge: Edge,
  edges: Edge[],
  wallById: Map<string, Wall>
): number {
  const otherEdge = edges.find(
    (e) => e.id !== edge.id && (e.nodeA === nodeId || e.nodeB === nodeId)
  );
  const otherWall = otherEdge ? wallById.get(otherEdge.wallId) : undefined;
  return otherWall?.thickness ?? 0;
}
