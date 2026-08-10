import type { Edge, Node, Point } from "../types.js";
import { signedArea } from "./vector.js";

/** A directed traversal of one Edge. Every Edge yields exactly two. */
export interface Dart {
  /** `dart:${edgeId}:AB` (nodeA→nodeB) or `dart:${edgeId}:BA` */
  id: string;
  edgeId: string;
  from: string;
  to: string;
  twinId: string;
  /** atan2 of the from→to direction, radians in (-PI, PI] */
  angle: number;
}

/**
 * One closed walk of darts with the same region on the same side throughout.
 *
 * NOT the same thing as a region: a region with a hole (the ring between two
 * drawn contours) contributes TWO cycles — its outer boundary and its hole
 * boundary. Regions are assembled from cycles in contours/regions.ts.
 */
export interface BoundaryCycle {
  id: string;
  dartIds: string[];
  /** ordered vertices of the walk; a node repeats where the walk passes a spur */
  nodeIds: string[];
  signedArea: number;
  /** true when this cycle bounds its component's unbounded (exterior) region */
  isUnbounded: boolean;
  componentId: string;
}

export interface PlanarFacesResult {
  darts: Map<string, Dart>;
  cycles: BoundaryCycle[];
  cycleIdByDartId: Map<string, string>;
  /**
   * Which side of a dart its cycle's region lies on, in the (dy, -dx) frame
   * shared with polygon.unitNormal and deriveOuterLine's OuterSide. Derived
   * from the input's own geometry, never assumed — see deriveBoundedAreaSign.
   */
  regionSideOfDart: 1 | -1;
  flags: string[];
}

/**
 * Splits the wall graph into its planar boundary cycles via half-edge
 * traversal, which is what lets corner classification survive T and cross
 * junctions: it never needs a "loop made only of L nodes", it walks whatever
 * the graph actually is.
 *
 * Fails loudly rather than quietly — a graph with no enclosed area, or with
 * walls that cross without a shared node, is flagged instead of producing
 * plausible-looking garbage.
 */
export function buildPlanarFaces(nodes: Node[], edges: Edge[]): PlanarFacesResult {
  const flags: string[] = [];
  const pointByNodeId = new Map(nodes.map((n) => [n.id, n.point]));

  const darts = new Map<string, Dart>();
  const usableEdges: Edge[] = [];
  for (const edge of edges) {
    const a = pointByNodeId.get(edge.nodeA);
    const b = pointByNodeId.get(edge.nodeB);
    if (!a || !b) continue;
    if (edge.nodeA === edge.nodeB || (a.x === b.x && a.y === b.y)) {
      pushOnce(flags, "degenerate-edge");
      continue;
    }
    usableEdges.push(edge);

    const forwardId = `dart:${edge.id}:AB`;
    const backwardId = `dart:${edge.id}:BA`;
    darts.set(forwardId, {
      id: forwardId,
      edgeId: edge.id,
      from: edge.nodeA,
      to: edge.nodeB,
      twinId: backwardId,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    });
    darts.set(backwardId, {
      id: backwardId,
      edgeId: edge.id,
      from: edge.nodeB,
      to: edge.nodeA,
      twinId: forwardId,
      angle: Math.atan2(a.y - b.y, a.x - b.x),
    });
  }

  if (findCrossingWithoutNode(usableEdges, pointByNodeId)) {
    pushOnce(flags, "edge-crossing-without-node");
  }

  const fans = buildFans(darts, flags);
  const componentIdByNodeId = buildComponents(nodes, usableEdges);

  const rawCycles = walkCycles(darts, fans, pointByNodeId, componentIdByNodeId);
  const cycleIdByDartId = new Map<string, string>();
  for (const cycle of rawCycles) {
    for (const dartId of cycle.dartIds) cycleIdByDartId.set(dartId, cycle.id);
  }

  const boundedAreaSign = deriveBoundedAreaSign(
    nodes,
    fans,
    cycleIdByDartId,
    rawCycles,
    componentIdByNodeId,
    flags
  );

  const cycles = rawCycles.map((cycle) => ({
    ...cycle,
    isUnbounded: boundedAreaSign === 0 || Math.sign(cycle.signedArea) !== boundedAreaSign,
  }));

  return {
    darts,
    cycles,
    cycleIdByDartId,
    // A positively-wound ring encloses its interior on the -(dy,-dx) side.
    regionSideOfDart: boundedAreaSign > 0 ? -1 : 1,
    flags,
  };
}

type RawCycle = Omit<BoundaryCycle, "isUnbounded">;

function buildFans(darts: Map<string, Dart>, flags: string[]): Map<string, Dart[]> {
  const fans = new Map<string, Dart[]>();
  for (const dart of darts.values()) {
    const list = fans.get(dart.from) ?? [];
    list.push(dart);
    fans.set(dart.from, list);
  }
  for (const [nodeId, list] of fans) {
    list.sort((a, b) => a.angle - b.angle || (a.edgeId < b.edgeId ? -1 : 1));
    for (let i = 1; i < list.length; i++) {
      if (Math.abs(list[i]!.angle - list[i - 1]!.angle) < 1e-9) {
        pushOnce(flags, "overlapping-edges-at-node");
      }
    }
    fans.set(nodeId, list);
  }
  return fans;
}

/**
 * The face-traversal successor: arrive along `dart`, then leave on the edge
 * immediately clockwise from the one we came in on (the predecessor of the
 * twin in ascending-angle order). Rotating consistently in one direction is
 * what keeps the same region on the same side of every dart in the walk.
 */
function nextDart(dart: Dart, darts: Map<string, Dart>, fans: Map<string, Dart[]>): Dart {
  const twin = darts.get(dart.twinId)!;
  const fan = fans.get(dart.to)!;
  const index = fan.findIndex((d) => d.id === twin.id);
  return fan[(index - 1 + fan.length) % fan.length]!;
}

function walkCycles(
  darts: Map<string, Dart>,
  fans: Map<string, Dart[]>,
  pointByNodeId: Map<string, Point>,
  componentIdByNodeId: Map<string, string>
): RawCycle[] {
  const cycles: RawCycle[] = [];
  const visited = new Set<string>();

  for (const start of darts.values()) {
    if (visited.has(start.id)) continue;

    const dartIds: string[] = [];
    const nodeIds: string[] = [];
    let current = start;
    do {
      visited.add(current.id);
      dartIds.push(current.id);
      nodeIds.push(current.from);
      current = nextDart(current, darts, fans);
    } while (current.id !== start.id);

    cycles.push({
      id: `cycle:${cycles.length}`,
      dartIds,
      nodeIds,
      signedArea: signedArea(nodeIds.map((id) => pointByNodeId.get(id)!)),
      componentId: componentIdByNodeId.get(start.from) ?? "component:0",
    });
  }

  return cycles;
}

function buildComponents(nodes: Node[], edges: Edge[]): Map<string, string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.nodeA, [...(adjacency.get(edge.nodeA) ?? []), edge.nodeB]);
    adjacency.set(edge.nodeB, [...(adjacency.get(edge.nodeB) ?? []), edge.nodeA]);
  }

  const componentIdByNodeId = new Map<string, string>();
  let index = 0;
  for (const node of nodes) {
    if (componentIdByNodeId.has(node.id)) continue;
    const componentId = `component:${index++}`;
    const queue = [node.id];
    componentIdByNodeId.set(node.id, componentId);
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (componentIdByNodeId.has(neighbor)) continue;
        componentIdByNodeId.set(neighbor, componentId);
        queue.push(neighbor);
      }
    }
  }
  return componentIdByNodeId;
}

/**
 * Which signed-area sign the BOUNDED faces carry under our nextDart rule.
 *
 * Determined from the drawing itself rather than reasoned about, because the
 * answer depends on both the rotation direction of nextDart and the canvas's
 * y-down axis, and getting it backwards silently mirrors every outward normal.
 *
 * The argument: take a component's lowest vertex (ties broken leftmost). It is
 * on the convex hull, so the exterior occupies the reflex wedge there. Every
 * edge leaves it heading upward, so the fan spans less than a half-turn and its
 * first and last darts bound that reflex wedge. nextDart(twin(first)) is last,
 * so `last` lies on the walk that occupies the wedge — the unbounded cycle.
 * The bounded sign is therefore the opposite of that cycle's.
 *
 * Returns 0 when no component encloses any area (a pure tree of walls).
 */
function deriveBoundedAreaSign(
  nodes: Node[],
  fans: Map<string, Dart[]>,
  cycleIdByDartId: Map<string, string>,
  cycles: RawCycle[],
  componentIdByNodeId: Map<string, string>,
  flags: string[]
): 0 | 1 | -1 {
  const cycleById = new Map(cycles.map((c) => [c.id, c]));
  const lowestByComponent = new Map<string, Node>();

  for (const node of nodes) {
    if (!fans.has(node.id)) continue;
    const componentId = componentIdByNodeId.get(node.id);
    if (!componentId) continue;
    const current = lowestByComponent.get(componentId);
    if (
      !current ||
      node.point.y < current.point.y ||
      (node.point.y === current.point.y && node.point.x < current.point.x)
    ) {
      lowestByComponent.set(componentId, node);
    }
  }

  let derived: 1 | -1 | 0 = 0;
  for (const node of lowestByComponent.values()) {
    const fan = fans.get(node.id)!;
    const unboundedDart = fan[fan.length - 1]!;
    const cycleId = cycleIdByDartId.get(unboundedDart.id);
    const cycle = cycleId ? cycleById.get(cycleId) : undefined;
    if (!cycle) continue;

    const sign = Math.sign(cycle.signedArea);
    if (sign === 0) continue;

    const candidate = (-sign as 1 | -1);
    if (derived === 0) derived = candidate;
    else if (derived !== candidate) pushOnce(flags, "inconsistent-orientation");
  }

  if (derived === 0) pushOnce(flags, "degenerate-graph");
  return derived;
}

/**
 * Two walls that cross mid-span without a shared node are not a planar
 * embedding, and the traversal would produce faces that don't exist. Cheap
 * O(n^2) scan — wall counts here are in the tens.
 */
function findCrossingWithoutNode(
  edges: Edge[],
  pointByNodeId: Map<string, Point>
): boolean {
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!;
      const b = edges[j]!;
      if (
        a.nodeA === b.nodeA ||
        a.nodeA === b.nodeB ||
        a.nodeB === b.nodeA ||
        a.nodeB === b.nodeB
      ) {
        continue;
      }
      const p1 = pointByNodeId.get(a.nodeA)!;
      const p2 = pointByNodeId.get(a.nodeB)!;
      const p3 = pointByNodeId.get(b.nodeA)!;
      const p4 = pointByNodeId.get(b.nodeB)!;
      if (segmentsProperlyIntersect(p1, p2, p3, p4)) return true;
    }
  }
  return false;
}

function segmentsProperlyIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const orient = (a: Point, b: Point, c: Point) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

function pushOnce(flags: string[], flag: string): void {
  if (!flags.includes(flag)) flags.push(flag);
}
