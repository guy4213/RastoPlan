import type { Edge, Point, Wall } from "../types.js";
import {
  angleBetweenDeg,
  perpendicularDistance,
  pointAlong,
  projectedOverlap,
} from "../geometry/polygon.js";
import type { ResolveOptions } from "./constants.js";
import { DEGENERATE_AREA_CM2, varianceLimitFor, withDefaults } from "./constants.js";
import { resolveWalls } from "./resolveWalls.js";

/** Two drawn lines the engine is confident are the two faces of one wall. */
export interface WallPairPreview {
  /** the contour the engine kept as the primary */
  wallId: string;
  /** the contour that turned out to be its far face */
  partnerId: string;
  /** the distance actually between them, which IS the wall thickness */
  thicknessCm: number;
}

/**
 * The pairings and measured thicknesses alone, without tiling anything.
 *
 * Closed contours are projected from `resolveWalls`, the same geometry layer
 * used by compute. While one wrapping contour is still open, its parallel
 * segments are matched to the already closed contour so their measured
 * thickness is visible immediately.
 *
 * The open-contour fallback is deliberately narrow: exactly one side belongs
 * to a bounded cycle, the other belongs to a different graph component, both
 * are in the same pour, and the normal parallel/overlap/thickness gates apply.
 * This prevents an attached loose partition from being treated as a far face.
 */
export function previewPairings(walls: Wall[], options: ResolveOptions = {}): WallPairPreview[] {
  const resolution = resolveWalls(walls, options);
  const { resolvedWalls, edges } = resolution;

  const degree = new Map<string, number>();
  for (const edge of edges) {
    for (const nodeId of [edge.nodeA, edge.nodeB]) {
      degree.set(nodeId, (degree.get(nodeId) ?? 0) + 1);
    }
  }

  const edgeByWallId = new Map(edges.map((e) => [e.wallId, e]));
  const isClosed = (wallId: string): boolean => {
    const edge = edgeByWallId.get(wallId);
    if (!edge) return false;
    return (degree.get(edge.nodeA) ?? 0) > 1 && (degree.get(edge.nodeB) ?? 0) > 1;
  };

  const closedPairs = resolvedWalls.flatMap((resolved): WallPairPreview[] => {
    if (resolved.thicknessSource !== "measured") return [];
    const partnerId = resolved.consumedWallIds[0];
    if (!partnerId) return [];
    if (!isClosed(resolved.sourceWallId) || !isClosed(partnerId)) return [];

    return [{ wallId: resolved.sourceWallId, partnerId, thicknessCm: resolved.thickness }];
  });

  return [...closedPairs, ...openContourPairings(walls, resolution, closedPairs, options)];
}

interface OpenCandidate extends WallPairPreview {
  closedEdgeId: string;
  openEdgeId: string;
  overlapCm: number;
  declaredMatch: boolean;
}

/** Pair the already-drawn parts of one open wrapping contour to a closed one. */
function openContourPairings(
  walls: Wall[],
  resolution: ReturnType<typeof resolveWalls>,
  closedPairs: WallPairPreview[],
  options: ResolveOptions
): WallPairPreview[] {
  const resolvedOptions = withDefaults(options);
  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const componentByNodeId = graphComponents(resolution.edges);

  // An edge on a real bounded face belongs to the contour that is already
  // closed. Degenerate back-and-forth walks made by a loose polyline do not.
  const closedEdgeIds = new Set<string>();
  for (const cycle of resolution.faces.cycles) {
    if (cycle.isUnbounded || Math.abs(cycle.signedArea) < DEGENERATE_AREA_CM2) continue;
    for (const dartId of cycle.dartIds) {
      const edgeId = resolution.faces.darts.get(dartId)?.edgeId;
      if (edgeId) closedEdgeIds.add(edgeId);
    }
  }

  const alreadyPairedWallIds = new Set(
    closedPairs.flatMap((pair) => [pair.wallId, pair.partnerId])
  );
  const closedEdges = resolution.edges.filter(
    (edge) => closedEdgeIds.has(edge.id) && !alreadyPairedWallIds.has(edge.wallId)
  );
  const openEdges = resolution.edges.filter(
    (edge) => !closedEdgeIds.has(edge.id) && !alreadyPairedWallIds.has(edge.wallId)
  );
  const candidates: OpenCandidate[] = [];

  for (const closedEdge of closedEdges) {
    const closedWall = wallById.get(closedEdge.wallId);
    if (!closedWall) continue;
    for (const openEdge of openEdges) {
      const openWall = wallById.get(openEdge.wallId);
      if (!openWall || openWall.pourId !== closedWall.pourId) continue;
      if (sameComponent(closedEdge, openEdge, componentByNodeId)) continue;

      const candidate = evaluateOpenCandidate(
        closedWall,
        openWall,
        closedEdge.id,
        openEdge.id,
        resolvedOptions
      );
      if (candidate) candidates.push(candidate);
    }
  }

  // Prefer a separation that agrees with either stored thickness, then the
  // nearest valid parallel run. Claim each segment only once.
  candidates.sort(
    (a, b) =>
      Number(b.declaredMatch) - Number(a.declaredMatch) ||
      a.thicknessCm - b.thicknessCm ||
      b.overlapCm - a.overlapCm ||
      a.closedEdgeId.localeCompare(b.closedEdgeId) ||
      a.openEdgeId.localeCompare(b.openEdgeId)
  );

  const claimed = new Set<string>();
  const result: WallPairPreview[] = [];
  for (const candidate of candidates) {
    if (claimed.has(candidate.closedEdgeId) || claimed.has(candidate.openEdgeId)) continue;
    claimed.add(candidate.closedEdgeId);
    claimed.add(candidate.openEdgeId);
    result.push({
      wallId: candidate.wallId,
      partnerId: candidate.partnerId,
      thicknessCm: candidate.thicknessCm,
    });
  }
  return result;
}

function evaluateOpenCandidate(
  closedWall: Wall,
  openWall: Wall,
  closedEdgeId: string,
  openEdgeId: string,
  options: ReturnType<typeof withDefaults>
): OpenCandidate | null {
  const angle = angleBetweenDeg(closedWall.innerLine, openWall.innerLine);
  if (Math.min(angle, 180 - angle) > options.parallelToleranceDeg) return null;

  const overlap = projectedOverlap(closedWall.innerLine, openWall.innerLine);
  if (!overlap) return null;
  const overlapCm = overlap[1] - overlap[0];
  const requiredOverlap = Math.max(
    options.minOverlapCm,
    options.minOverlapFraction *
      Math.min(lineLength(closedWall.innerLine), lineLength(openWall.innerLine))
  );
  if (overlapCm < requiredOverlap) return null;

  const distances = [0.1, 0.5, 0.9].map((fraction) =>
    perpendicularDistance(
      pointAlong(closedWall.innerLine, overlap[0] + fraction * overlapCm),
      openWall.innerLine
    )
  );
  const thicknessCm = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
  const variance = Math.max(...distances) - Math.min(...distances);
  if (variance > varianceLimitFor(thicknessCm, options.thicknessVarianceCm)) return null;
  if (thicknessCm < options.minThicknessCm || thicknessCm > options.maxThicknessCm) return null;

  const declaredMatch = [closedWall.thickness, openWall.thickness].some(
    (declared) => Math.abs(declared - thicknessCm) <= options.declaredThicknessToleranceCm
  );

  return {
    wallId: closedWall.id,
    partnerId: openWall.id,
    thicknessCm,
    closedEdgeId,
    openEdgeId,
    overlapCm,
    declaredMatch,
  };
}

function graphComponents(edges: Edge[]): Map<string, string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.nodeA, [...(adjacency.get(edge.nodeA) ?? []), edge.nodeB]);
    adjacency.set(edge.nodeB, [...(adjacency.get(edge.nodeB) ?? []), edge.nodeA]);
  }

  const componentByNodeId = new Map<string, string>();
  let index = 0;
  for (const nodeId of adjacency.keys()) {
    if (componentByNodeId.has(nodeId)) continue;
    const componentId = `preview-component:${index++}`;
    const pending = [nodeId];
    componentByNodeId.set(nodeId, componentId);
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (componentByNodeId.has(next)) continue;
        componentByNodeId.set(next, componentId);
        pending.push(next);
      }
    }
  }
  return componentByNodeId;
}

function sameComponent(a: Edge, b: Edge, componentByNodeId: Map<string, string>): boolean {
  return componentByNodeId.get(a.nodeA) === componentByNodeId.get(b.nodeA);
}

function lineLength(line: [Point, Point]): number {
  return Math.hypot(line[1].x - line[0].x, line[1].y - line[0].y);
}

/**
 * The same pairings keyed by wall id, from BOTH sides, so a lookup works
 * whichever of the two contours the user happens to have selected.
 */
export function previewPairingByWallId(
  walls: Wall[],
  options: ResolveOptions = {}
): Map<string, { partnerId: string; thicknessCm: number }> {
  const byWallId = new Map<string, { partnerId: string; thicknessCm: number }>();

  for (const pair of previewPairings(walls, options)) {
    byWallId.set(pair.wallId, { partnerId: pair.partnerId, thicknessCm: pair.thicknessCm });
    byWallId.set(pair.partnerId, { partnerId: pair.wallId, thicknessCm: pair.thicknessCm });
  }
  return byWallId;
}
