import type { Node, Point } from "../types.js";
import type { PlanarFacesResult } from "../geometry/planarFaces.js";
import {
  angleBetweenDeg,
  closestPointOnLine,
  perpendicularDistance,
  pointAlong,
  pointInPolygon,
  projectedOverlap,
  unitNormal,
} from "../geometry/polygon.js";
import type { ResolvedOptions } from "./constants.js";
import { OUTSIDE_REGION_ID, regionSegments } from "./regions.js";
import type { Region, RegionSegment } from "./regions.js";

/** Two boundary segments identified as the two faces of one physical wall. */
export interface FacePairing {
  edgeAId: string;
  edgeBId: string;
  /** the region filling the space between them — the wall body */
  betweenRegionId: string;
  measuredThicknessCm: number;
  thicknessVarianceCm: number;
  /** length of the shared run, measured along edge A */
  overlapCm: number;
  /** direction from edge A's line to edge B's, in the (dy,-dx) frame of A's nodeA→nodeB */
  aToBSign: 1 | -1;
  flags: string[];
}

export interface PairFacesResult {
  pairings: FacePairing[];
  coverageByRegionId: Map<string, number>;
}

/** Where along the shared run the separation is sampled, as overlap fractions. */
const SAMPLE_FRACTIONS = [0.1, 0.5, 0.9];

/**
 * Finds, for each region, the boundary segments that face each other across it
 * at a constant wall-like separation. A region whose boundary is almost entirely
 * paired up this way is not a room at all — it is the wall material between two
 * drawn contours.
 *
 * Draw order is deliberately irrelevant: the two contours of a plan are usually
 * traced the same way round, so corresponding faces come out parallel rather
 * than anti-parallel, and both are accepted. Only geometry decides.
 */
export function pairFaces(
  nodes: Node[],
  faces: PlanarFacesResult,
  regions: Region[],
  options: ResolvedOptions
): PairFacesResult {
  const pointByNodeId = new Map(nodes.map((n) => [n.id, n.point]));
  const cycleById = new Map(faces.cycles.map((c) => [c.id, c] as const));
  const polygonOf = (cycleId: string): Point[] =>
    (cycleById.get(cycleId)?.nodeIds ?? []).map((id) => pointByNodeId.get(id)!).filter(Boolean);

  const pairings: FacePairing[] = [];
  const coverageByRegionId = new Map<string, number>();

  for (const region of regions) {
    if (region.id === OUTSIDE_REGION_ID || region.outerCycleId === "") {
      coverageByRegionId.set(region.id, 0);
      continue;
    }

    const segments = regionSegments(region, faces, nodes);
    const outer = polygonOf(region.outerCycleId);
    const holes = region.holeCycleIds.map(polygonOf);
    const insideRegion = (p: Point) =>
      pointInPolygon(p, outer) && !holes.some((hole) => pointInPolygon(p, hole));

    const candidates: FacePairing[] = [];
    const dartIdByPairing = new Map<FacePairing, [string, string]>();

    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i]!;
        const b = segments[j]!;
        if (a.edgeId === b.edgeId) continue;

        const pairing = evaluate(a, b, region.id, options, insideRegion);
        if (!pairing) continue;
        candidates.push(pairing);
        dartIdByPairing.set(pairing, [a.dartId, b.dartId]);
      }
    }

    candidates.sort(
      (x, y) =>
        y.overlapCm - x.overlapCm ||
        x.thicknessVarianceCm - y.thicknessVarianceCm ||
        (x.edgeAId < y.edgeAId ? -1 : 1)
    );

    const claimed = new Set<string>();
    let pairedLength = 0;
    for (const candidate of candidates) {
      const [dartA, dartB] = dartIdByPairing.get(candidate)!;
      if (claimed.has(dartA) || claimed.has(dartB)) continue;
      claimed.add(dartA);
      claimed.add(dartB);
      pairings.push(candidate);
      pairedLength += candidate.overlapCm * 2;
    }

    const boundaryLength = segments.reduce((sum, s) => sum + s.length, 0);
    coverageByRegionId.set(
      region.id,
      boundaryLength > 0 ? Math.min(1, pairedLength / boundaryLength) : 0
    );
  }

  return { pairings, coverageByRegionId };
}

function evaluate(
  a: RegionSegment,
  b: RegionSegment,
  regionId: string,
  options: ResolvedOptions,
  insideRegion: (p: Point) => boolean
): FacePairing | null {
  const angle = angleBetweenDeg(a.line, b.line);
  const offParallel = Math.min(angle, 180 - angle);
  if (offParallel > options.parallelToleranceDeg) return null;

  const overlap = projectedOverlap(a.line, b.line);
  if (!overlap) return null;
  const overlapCm = overlap[1] - overlap[0];
  const required = Math.max(
    options.minOverlapCm,
    options.minOverlapFraction * Math.min(a.length, b.length)
  );
  if (overlapCm < required) return null;

  const samples = SAMPLE_FRACTIONS.map((fraction) =>
    pointAlong(a.line, overlap[0] + fraction * overlapCm)
  );
  const distances = samples.map((p) => perpendicularDistance(p, b.line));
  const mean = distances.reduce((sum, d) => sum + d, 0) / distances.length;
  const variance = Math.max(...distances) - Math.min(...distances);

  if (variance > options.thicknessVarianceCm) return null;
  if (mean < options.minThicknessCm || mean > options.maxThicknessCm) return null;

  // The material has to actually lie between them: without this, two walls on
  // opposite sides of a narrow room would pair straight through the room.
  const middle = samples[1]!;
  const opposite = closestPointOnLine(middle, b.line);
  const strip = { x: (middle.x + opposite.x) / 2, y: (middle.y + opposite.y) / 2 };
  if (!insideRegion(strip)) return null;

  const flags: string[] = [];
  if (overlapCm < a.length - 1e-6 || overlapCm < b.length - 1e-6) flags.push("partial-overlap");

  return {
    edgeAId: a.edgeId,
    edgeBId: b.edgeId,
    betweenRegionId: regionId,
    measuredThicknessCm: mean,
    thicknessVarianceCm: variance,
    overlapCm,
    aToBSign: signFromAToB(a, b),
    flags,
  };
}

/**
 * Expressed in edge A's canonical nodeA→nodeB frame rather than the dart's, so
 * the answer matches the wall's own innerLine and can be handed straight to
 * deriveOuterLine.
 */
function signFromAToB(a: RegionSegment, b: RegionSegment): 1 | -1 {
  const canonical: [Point, Point] = a.dartId.endsWith(":AB")
    ? a.line
    : [a.line[1], a.line[0]];
  const n = unitNormal(canonical[0], canonical[1]);
  if (!n) return 1;

  const target = { x: (b.line[0].x + b.line[1].x) / 2, y: (b.line[0].y + b.line[1].y) / 2 };
  const toTarget = { x: target.x - canonical[0].x, y: target.y - canonical[0].y };
  return toTarget.x * n.x + toTarget.y * n.y >= 0 ? 1 : -1;
}
