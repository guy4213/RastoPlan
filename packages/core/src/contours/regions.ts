import type { Node, Point } from "../types.js";
import type { BoundaryCycle, PlanarFacesResult } from "../geometry/planarFaces.js";
import { interiorSamplePoint, pointInPolygon } from "../geometry/polygon.js";
import { DEGENERATE_AREA_CM2 } from "./constants.js";

export type RegionKind = "outside" | "wall-material" | "room" | "ambiguous";

export const OUTSIDE_REGION_ID = "region:outside";

/**
 * A planar area of the drawing. Not the same as a boundary cycle: a region with
 * something nested inside it is bounded by its own outer cycle plus one hole
 * cycle per nested component, and that nesting is what turns the customer's two
 * drawn rectangles into a single ring of wall material.
 */
export interface Region {
  id: string;
  kind: RegionKind;
  /** the cycle whose polygon encloses this region; "" for the outside region */
  outerCycleId: string;
  /** outer boundaries of the components nested directly inside — this region's holes */
  holeCycleIds: string[];
  /** outer + holes: every cycle that bounds this region */
  boundaryCycleIds: string[];
  /** enclosed area minus the holes' areas; Infinity for the outside region */
  area: number;
  /** fraction of the boundary matched by a face pairing across this region */
  pairedCoverage: number;
  /** enclosing regions, innermost first */
  containedInRegionIds: string[];
  flags: string[];
}

export interface BuildRegionsResult {
  regions: Region[];
  /** every cycle, bounded or not, mapped to the region it bounds */
  regionIdByCycleId: Map<string, string>;
}

/**
 * Assembles boundary cycles into regions, resolving nesting across disconnected
 * components. Every cycle ends up attributed to exactly one region: a bounded
 * cycle to the area it encloses, an unbounded cycle to whatever area its
 * component floats in.
 */
export function buildRegions(faces: PlanarFacesResult, nodes: Node[]): BuildRegionsResult {
  const pointByNodeId = new Map(nodes.map((n) => [n.id, n.point]));
  const polygonOf = (cycle: BoundaryCycle) =>
    cycle.nodeIds.map((id) => pointByNodeId.get(id)!).filter(Boolean);

  const bounded = faces.cycles.filter(
    (c) => !c.isUnbounded && Math.abs(c.signedArea) >= DEGENERATE_AREA_CM2
  );
  const polygons = new Map(bounded.map((c) => [c.id, polygonOf(c)] as const));
  const areas = new Map(bounded.map((c) => [c.id, Math.abs(c.signedArea)] as const));

  const contains = (outerId: string, sample: Point | null): boolean => {
    if (!sample) return false;
    const polygon = polygons.get(outerId);
    return !!polygon && pointInPolygon(sample, polygon);
  };

  interface ContainmentQuery {
    /** skip this cycle and anything no bigger than it — used to find a strict parent */
    largerThanCycleId?: string;
    /** skip the asking cycle's own component, whose faces it is trivially adjacent to */
    excludeComponentId?: string;
  }

  /** Smallest bounded cycle containing `sample`, or null when nothing does. */
  const smallestContaining = (
    sample: Point | null,
    query: ContainmentQuery = {}
  ): string | null => {
    let best: string | null = null;
    for (const cycle of bounded) {
      if (cycle.componentId === query.excludeComponentId) continue;
      if (query.largerThanCycleId) {
        if (cycle.id === query.largerThanCycleId) continue;
        if (areas.get(cycle.id)! <= areas.get(query.largerThanCycleId)!) continue;
      }
      if (!contains(cycle.id, sample)) continue;
      if (best === null || areas.get(cycle.id)! < areas.get(best)!) best = cycle.id;
    }
    return best;
  };

  const parentByCycleId = new Map<string, string | null>();
  for (const cycle of bounded) {
    parentByCycleId.set(
      cycle.id,
      smallestContaining(interiorSamplePoint(polygons.get(cycle.id)!), {
        largerThanCycleId: cycle.id,
      })
    );
  }

  // Each component's unbounded cycle is a hole in whichever region its component
  // floats in — this is the step that connects the two separately-drawn contours.
  const unbounded = faces.cycles.filter((c) => c.isUnbounded);
  const hostByUnboundedCycleId = new Map<string, string | null>();
  for (const cycle of unbounded) {
    const polygon = polygonOf(cycle);
    const sample =
      interiorSamplePoint(polygon) ?? pointByNodeId.get(cycle.nodeIds[0]!) ?? null;
    hostByUnboundedCycleId.set(
      cycle.id,
      smallestContaining(sample, { excludeComponentId: cycle.componentId })
    );
  }

  const holesByCycleId = new Map<string, string[]>();
  for (const [unboundedId, hostId] of hostByUnboundedCycleId) {
    if (!hostId) continue;
    holesByCycleId.set(hostId, [...(holesByCycleId.get(hostId) ?? []), unboundedId]);
  }

  const regionIdByCycleId = new Map<string, string>();
  const regions: Region[] = [];
  const takenIds = new Set<string>();

  for (const cycle of bounded) {
    const holeCycleIds = holesByCycleId.get(cycle.id) ?? [];
    const holeArea = holeCycleIds.reduce((sum, id) => {
      const hole = faces.cycles.find((c) => c.id === id);
      return sum + (hole ? Math.abs(hole.signedArea) : 0);
    }, 0);

    const region: Region = {
      id: uniqueRegionId(cycle, takenIds),
      kind: "room",
      outerCycleId: cycle.id,
      holeCycleIds,
      boundaryCycleIds: [cycle.id, ...holeCycleIds],
      area: Math.abs(cycle.signedArea) - holeArea,
      pairedCoverage: 0,
      containedInRegionIds: [],
      flags: [],
    };
    regions.push(region);
    for (const cycleId of region.boundaryCycleIds) regionIdByCycleId.set(cycleId, region.id);
  }

  const regionByCycleId = new Map(regions.map((r) => [r.outerCycleId, r] as const));
  for (const region of regions) {
    const chain: string[] = [];
    let parent = parentByCycleId.get(region.outerCycleId) ?? null;
    while (parent) {
      const parentRegion = regionByCycleId.get(parent);
      if (!parentRegion || chain.includes(parentRegion.id)) break;
      chain.push(parentRegion.id);
      parent = parentByCycleId.get(parent) ?? null;
    }
    region.containedInRegionIds = chain;
  }

  const topLevelHoles = [...hostByUnboundedCycleId.entries()]
    .filter(([, host]) => host === null)
    .map(([cycleId]) => cycleId);
  const outside: Region = {
    id: OUTSIDE_REGION_ID,
    kind: "outside",
    outerCycleId: "",
    holeCycleIds: topLevelHoles,
    boundaryCycleIds: topLevelHoles,
    area: Infinity,
    pairedCoverage: 0,
    containedInRegionIds: [],
    flags: [],
  };
  regions.push(outside);
  for (const cycleId of topLevelHoles) regionIdByCycleId.set(cycleId, OUTSIDE_REGION_ID);

  // Degenerate cycles were excluded above; park them on the outside region so
  // callers never hit an unmapped cycle.
  for (const cycle of faces.cycles) {
    if (!regionIdByCycleId.has(cycle.id)) regionIdByCycleId.set(cycle.id, OUTSIDE_REGION_ID);
  }

  return { regions, regionIdByCycleId };
}

/** One directed boundary segment of a region, in the region's own traversal frame. */
export interface RegionSegment {
  regionId: string;
  cycleId: string;
  dartId: string;
  edgeId: string;
  line: [Point, Point];
  length: number;
}

export function regionSegments(
  region: Region,
  faces: PlanarFacesResult,
  nodes: Node[]
): RegionSegment[] {
  const pointByNodeId = new Map(nodes.map((n) => [n.id, n.point]));
  const cycleById = new Map(faces.cycles.map((c) => [c.id, c] as const));

  const segments: RegionSegment[] = [];
  for (const cycleId of region.boundaryCycleIds) {
    const cycle = cycleById.get(cycleId);
    if (!cycle) continue;
    for (const dartId of cycle.dartIds) {
      const dart = faces.darts.get(dartId);
      if (!dart) continue;
      const from = pointByNodeId.get(dart.from);
      const to = pointByNodeId.get(dart.to);
      if (!from || !to) continue;
      segments.push({
        regionId: region.id,
        cycleId,
        dartId,
        edgeId: dart.edgeId,
        line: [from, to],
        length: Math.hypot(to.x - from.x, to.y - from.y),
      });
    }
  }
  return segments;
}

/**
 * Node ids are `node:N` in graph-build order, so the numerically smallest index
 * on the ring is a stable name that survives unrelated walls being appended —
 * unlike the cycle's own discovery-order id. Several faces can share their
 * lowest node (a vertex where three rooms meet), so collisions get a suffix
 * rather than silently merging two regions into one.
 */
function uniqueRegionId(cycle: BoundaryCycle, taken: Set<string>): string {
  let smallest = Infinity;
  for (const nodeId of cycle.nodeIds) {
    const index = Number(nodeId.split(":")[1]);
    if (Number.isFinite(index) && index < smallest) smallest = index;
  }

  const base = Number.isFinite(smallest) ? `region:${smallest}` : `region:${cycle.id}`;
  let id = base;
  for (let suffix = 2; taken.has(id); suffix++) id = `${base}#${suffix}`;
  taken.add(id);
  return id;
}
