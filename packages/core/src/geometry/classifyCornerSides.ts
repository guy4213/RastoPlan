import type { Edge, Node } from "../types.js";
import { cross2, signedArea, subtract } from "./vector.js";

interface Neighbor {
  edgeId: string;
  otherNodeId: string;
}

/**
 * For each 'L' node that sits on a fully closed loop of 'L' nodes, decides
 * whether it's concave ('inner' — e.g. the notch of an L-shaped room) or
 * convex ('outer' — e.g. a regular box corner), by comparing the local turn
 * at that node to the loop's overall winding direction (shoelace sign).
 * This works regardless of coordinate convention or which way the loop was
 * traced, since both signs come from the same coordinates.
 *
 * 'L' nodes that aren't part of a closed loop (e.g. a chain that runs into
 * a T/cross/end before returning to its start) are left unclassified —
 * there's no enclosed area to determine a side from.
 */
export function classifyCornerSides(nodes: Node[], edges: Edge[]): Node[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = buildAdjacency(edges);
  const cornerSideById = new Map<string, "inner" | "outer">();

  for (const node of nodes) {
    if (node.type !== "L" || cornerSideById.has(node.id)) continue;

    const loop = traceLoop(node.id, adjacency, nodeById);
    if (!loop) continue;

    const area = signedArea(loop.map((id) => nodeById.get(id)!.point));
    for (let i = 0; i < loop.length; i++) {
      const id = loop[i]!;
      const loopNode = nodeById.get(id)!;
      if (loopNode.type !== "L") continue;

      const prev = nodeById.get(loop[(i - 1 + loop.length) % loop.length]!)!.point;
      const curr = loopNode.point;
      const next = nodeById.get(loop[(i + 1) % loop.length]!)!.point;
      const turn = cross2(subtract(curr, prev), subtract(next, curr));

      cornerSideById.set(id, Math.sign(turn) === Math.sign(area) ? "outer" : "inner");
    }
  }

  return nodes.map((node) =>
    cornerSideById.has(node.id) ? { ...node, cornerSide: cornerSideById.get(node.id) } : node
  );
}

function buildAdjacency(edges: Edge[]): Map<string, Neighbor[]> {
  const adjacency = new Map<string, Neighbor[]>();
  const add = (nodeId: string, neighbor: Neighbor) => {
    const list = adjacency.get(nodeId) ?? [];
    list.push(neighbor);
    adjacency.set(nodeId, list);
  };
  for (const edge of edges) {
    add(edge.nodeA, { edgeId: edge.id, otherNodeId: edge.nodeB });
    add(edge.nodeB, { edgeId: edge.id, otherNodeId: edge.nodeA });
  }
  return adjacency;
}

/**
 * Walks from `startId` through consecutive 'L' nodes until it returns to
 * the start (closed loop — returns the ordered node ids) or reaches a
 * non-'L' node (open chain — returns null).
 */
function traceLoop(
  startId: string,
  adjacency: Map<string, Neighbor[]>,
  nodeById: Map<string, Node>
): string[] | null {
  const startNeighbors = adjacency.get(startId) ?? [];
  if (startNeighbors.length !== 2) return null;

  const path: string[] = [startId];
  let prevId = startId;
  let currId = startNeighbors[0]!.otherNodeId;

  while (currId !== startId) {
    const currNode = nodeById.get(currId);
    if (!currNode || currNode.type !== "L") return null;

    path.push(currId);
    const neighbors = adjacency.get(currId) ?? [];
    if (neighbors.length !== 2) return null;

    const next = neighbors.find((n) => n.otherNodeId !== prevId);
    if (!next) return null;

    prevId = currId;
    currId = next.otherNodeId;
  }

  return path;
}
