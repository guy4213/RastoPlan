import type { Edge, Node, NodeType } from "../types.js";

/** Sets each Node's `type` from how many Edges are incident to it. */
export function classifyNodes(nodes: Node[], edges: Edge[]): Node[] {
  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);
  for (const edge of edges) {
    degree.set(edge.nodeA, (degree.get(edge.nodeA) ?? 0) + 1);
    degree.set(edge.nodeB, (degree.get(edge.nodeB) ?? 0) + 1);
  }

  return nodes.map((node) => ({
    ...node,
    type: typeForDegree(degree.get(node.id) ?? 0),
  }));
}

function typeForDegree(degree: number): NodeType {
  if (degree <= 1) return "end";
  if (degree === 2) return "L";
  if (degree === 3) return "T";
  // 4 is the spec's 'cross'. 5+ isn't in spec (unusual for formwork) —
  // treated as 'cross' rather than throwing.
  return "cross";
}
