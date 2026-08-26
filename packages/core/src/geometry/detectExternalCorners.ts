import type { Edge, ExternalCorner, Node, Point, Wall } from "../types.js";
import { classifyNodes } from "./classifyNodes.js";
import { classifyCornerSides } from "./classifyCornerSides.js";
import { buildPlanarFaces } from "./planarFaces.js";

/** Values this close to an arm are on its axis, not inside either quadrant. */
const PROJECTION_EPSILON_CM = 0.01;

/**
 * Finds the unambiguous convex facade corners in the active wall graph.
 *
 * An L node divides its surroundings into four wedges. The wedge between its
 * two wall arms is the possible building side; the opposite wedge is the
 * possible exterior. A real outside corner has substantially more drawing in
 * the building wedge and a clear route on the opposite side. Closed-room
 * corners are held to the stricter form of that rule so an internal shaft or
 * room does not receive K30 simply because it is rectangular.
 *
 * Only graph nodes are inspected. This is intentionally O(n²) over a small
 * wall graph, rather than rasterising the canvas; recalculation therefore does
 * not reintroduce the performance regression seen in the UI.
 */
export function detectExternalCorners(
  nodes: readonly Node[],
  edges: readonly Edge[],
  walls: readonly Wall[]
): ExternalCorner[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const result: ExternalCorner[] = [];

  const pourIds = new Set(
    edges.map((edge) => wallById.get(edge.wallId)?.pourId).filter(isString)
  );
  for (const pourId of pourIds) {
    // A junction shared by two pours may be T globally but remain a plain L
    // within each casting operation. Reclassifying the pour subgraph prevents
    // a later pour from erasing K30 corners already required by an earlier one.
    const pourEdges = edges.filter((edge) => wallById.get(edge.wallId)?.pourId === pourId);
    const incidentByNodeId = incidentEdges(pourEdges);
    const pourNodes = nodes
      .filter((node) => incidentByNodeId.has(node.id))
      .map((node) => ({ ...node, flags: [], cornerSide: undefined }));
    const locallyClassified = classifyNodes(pourNodes, pourEdges);
    const faces = buildPlanarFaces(locallyClassified, pourEdges);
    const activeNodes = classifyCornerSides(locallyClassified, faces).nodes;
    const activeNodeById = new Map(activeNodes.map((node) => [node.id, node]));
    const componentByNodeId = connectedComponents(incidentByNodeId, pourEdges);

    for (const node of activeNodes) {
      if (node.type !== "L") continue;
      const incident = incidentByNodeId.get(node.id) ?? [];
      if (incident.length !== 2) continue;

      const arms = incident
        .map((edge) => {
          const otherId = edge.nodeA === node.id ? edge.nodeB : edge.nodeA;
          const other = activeNodeById.get(otherId) ?? nodeById.get(otherId);
          return other ? normalize(subtract(other.point, node.point)) : null;
        })
        .filter((arm): arm is Point => arm !== null);
      if (arms.length !== 2) continue;

      // classifyNodes already calls this an L, but retaining the dot-product
      // guard keeps corrupt/legacy layouts from manufacturing a diagonal wedge.
      if (Math.abs(dot(arms[0]!, arms[1]!)) > 0.25) continue;

      const componentId = componentByNodeId.get(node.id);
      const neighborhood = activeNodes.filter(
        (candidate) =>
          candidate.id !== node.id && componentByNodeId.get(candidate.id) === componentId
      );
      const exposure = quadrantCounts(node.point, arms[0]!, arms[1]!, neighborhood);
      const unresolved = node.flags.includes("unresolved-corner-side");
      const multiRegion = node.flags.includes("multi-region-corner");

      let external = false;
      if (!unresolved) {
        external = !multiRegion && exposure.opposite === 0 && exposure.minor > 0;
      } else {
        const directlyExposed =
          exposure.opposite <= 2 && exposure.minor > exposure.opposite;
        const exposedAlongOneSide =
          Math.min(exposure.sideA, exposure.sideB) <= 2 &&
          exposure.minor >= 3 &&
          exposure.opposite >= 4;
        external = directlyExposed || exposedAlongOneSide;
      }

      if (external) result.push({ point: { ...node.point }, pourId });
    }
  }

  return result;
}

function incidentEdges(edges: readonly Edge[]): Map<string, Edge[]> {
  const result = new Map<string, Edge[]>();
  for (const edge of edges) {
    result.set(edge.nodeA, [...(result.get(edge.nodeA) ?? []), edge]);
    result.set(edge.nodeB, [...(result.get(edge.nodeB) ?? []), edge]);
  }
  return result;
}

interface QuadrantCounts {
  minor: number;
  opposite: number;
  sideA: number;
  sideB: number;
}

function quadrantCounts(
  origin: Point,
  armA: Point,
  armB: Point,
  nodes: readonly Node[]
): QuadrantCounts {
  const counts: QuadrantCounts = { minor: 0, opposite: 0, sideA: 0, sideB: 0 };

  for (const node of nodes) {
    const relative = subtract(node.point, origin);
    const a = dot(relative, armA);
    const b = dot(relative, armB);
    if (Math.abs(a) <= PROJECTION_EPSILON_CM || Math.abs(b) <= PROJECTION_EPSILON_CM) continue;

    if (a > 0 && b > 0) counts.minor++;
    else if (a < 0 && b < 0) counts.opposite++;
    else if (a > 0) counts.sideA++;
    else counts.sideB++;
  }

  return counts;
}

function connectedComponents(
  incidentByNodeId: ReadonlyMap<string, readonly Edge[]>,
  edges: readonly Edge[]
): Map<string, string> {
  const neighbors = new Map<string, string[]>();
  for (const edge of edges) {
    neighbors.set(edge.nodeA, [...(neighbors.get(edge.nodeA) ?? []), edge.nodeB]);
    neighbors.set(edge.nodeB, [...(neighbors.get(edge.nodeB) ?? []), edge.nodeA]);
  }

  const result = new Map<string, string>();
  let index = 0;
  for (const nodeId of incidentByNodeId.keys()) {
    if (result.has(nodeId)) continue;
    const componentId = `external-component:${index++}`;
    const pending = [nodeId];
    result.set(nodeId, componentId);
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const neighbor of neighbors.get(current) ?? []) {
        if (result.has(neighbor)) continue;
        result.set(neighbor, componentId);
        pending.push(neighbor);
      }
    }
  }
  return result;
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function normalize(vector: Point): Point | null {
  const length = Math.hypot(vector.x, vector.y);
  return length === 0 ? null : { x: vector.x / length, y: vector.y / length };
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
