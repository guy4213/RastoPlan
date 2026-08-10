import type { Edge, Node, NodeType, Point } from "../types.js";
import { subtract } from "./vector.js";

/**
 * How far a degree-2 vertex may deflect from dead straight and still be one
 * continuous wall rather than a corner. Retraced plans rarely land on exactly
 * 180°, and a 2mm-over-4m drafting wobble must not conjure a corner panel.
 */
export const STRAIGHT_JOIN_TOLERANCE_DEG = 8;

export interface ClassifyNodesOptions {
  straightJoinToleranceDeg?: number;
}

/**
 * Sets each Node's `type` from its incident edges: degree alone for 1/3/4+,
 * and for degree 2 the angle as well, because a straight seam and a corner are
 * both degree 2 but cost completely different hardware.
 */
export function classifyNodes(
  nodes: Node[],
  edges: Edge[],
  options: ClassifyNodesOptions = {}
): Node[] {
  const tolerance = options.straightJoinToleranceDeg ?? STRAIGHT_JOIN_TOLERANCE_DEG;
  const pointByNodeId = new Map(nodes.map((n) => [n.id, n.point]));

  const neighbors = new Map<string, string[]>();
  for (const node of nodes) neighbors.set(node.id, []);
  for (const edge of edges) {
    neighbors.get(edge.nodeA)?.push(edge.nodeB);
    neighbors.get(edge.nodeB)?.push(edge.nodeA);
  }

  return nodes.map((node) => {
    const adjacent = neighbors.get(node.id) ?? [];
    if (adjacent.length !== 2) {
      return { ...node, type: typeForDegree(adjacent.length), flags: node.flags ?? [] };
    }

    const deflection = deflectionDeg(
      node.point,
      pointByNodeId.get(adjacent[0]!),
      pointByNodeId.get(adjacent[1]!)
    );
    if (deflection === null) {
      return { ...node, type: "L" as NodeType, flags: node.flags ?? [] };
    }

    if (Math.abs(180 - deflection) <= tolerance) {
      return { ...node, type: "straight-join" as NodeType, flags: node.flags ?? [] };
    }
    // Both edges leaving in the same direction: the walls double back on each
    // other, which is a drawing error, not a corner we can lay formwork around.
    if (deflection <= tolerance) {
      return {
        ...node,
        type: "L" as NodeType,
        flags: withFlag(node.flags, "degenerate-turn"),
      };
    }
    return { ...node, type: "L" as NodeType, flags: node.flags ?? [] };
  });
}

/** Angle between the two directions leaving `at`, in [0, 180]. */
function deflectionDeg(at: Point, a: Point | undefined, b: Point | undefined): number | null {
  if (!a || !b) return null;
  const u = subtract(a, at);
  const v = subtract(b, at);
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (lu === 0 || lv === 0) return null;

  const cos = Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function typeForDegree(degree: number): NodeType {
  if (degree <= 1) return "end";
  if (degree === 3) return "T";
  // 4 is the spec's 'cross'. 5+ isn't in spec (unusual for formwork) —
  // treated as 'cross' rather than throwing.
  return "cross";
}

function withFlag(flags: string[] | undefined, flag: string): string[] {
  const current = flags ?? [];
  return current.includes(flag) ? current : [...current, flag];
}
