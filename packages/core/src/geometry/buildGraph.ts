import type { Edge, Node, Point, Wall } from "../types.js";
import { distance } from "./vector.js";

/** Endpoints closer than this (cm) are treated as the same physical corner. */
export const SNAP_TOLERANCE_CM = 2;

export interface BuildGraphResult {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Turns each Wall's innerLine into a graph: nearby endpoints (within
 * SNAP_TOLERANCE_CM) snap together into one Node, and each Wall becomes one
 * Edge between its two (possibly shared) Nodes.
 *
 * Node/Edge ids are derived from input order/wallId (not random), so the
 * same `walls` array always produces the same graph.
 */
export function buildGraph(walls: Wall[]): BuildGraphResult {
  const nodes: Node[] = [];
  // Parallel to `nodes`: how many endpoints have snapped into each node so
  // far, used to keep a running average of the merged point.
  const mergeCounts: number[] = [];

  function resolveNode(point: Point): string {
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = distance(nodes[i]!.point, point);
      if (d <= SNAP_TOLERANCE_CM && d < nearestDistance) {
        nearestIndex = i;
        nearestDistance = d;
      }
    }

    if (nearestIndex === -1) {
      const node: Node = {
        id: `node:${nodes.length}`,
        point,
        // Placeholder — classifyNodes() is responsible for the real value.
        type: "end",
        flags: [],
      };
      nodes.push(node);
      mergeCounts.push(1);
      return node.id;
    }

    const count = mergeCounts[nearestIndex]!;
    const existing = nodes[nearestIndex]!;
    const merged: Point = {
      x: (existing.point.x * count + point.x) / (count + 1),
      y: (existing.point.y * count + point.y) / (count + 1),
    };
    nodes[nearestIndex] = { ...existing, point: merged };
    mergeCounts[nearestIndex] = count + 1;
    return existing.id;
  }

  const edges: Edge[] = walls.map((wall) => {
    const nodeA = resolveNode(wall.innerLine[0]);
    const nodeB = resolveNode(wall.innerLine[1]);
    return {
      id: `edge:${wall.id}`,
      wallId: wall.id,
      nodeA,
      nodeB,
      clearLength: distance(wall.innerLine[0], wall.innerLine[1]),
      flags: [],
    };
  });

  return { nodes, edges };
}
