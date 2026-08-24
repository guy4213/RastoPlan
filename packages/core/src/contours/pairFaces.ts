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
import { varianceLimitFor } from "./constants.js";
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
  /** the separation confirms a thickness the user typed on one of the two walls */
  declaredMatch: boolean;
  flags: string[];
}

/**
 * Why a candidate pair was turned down. The split is load-bearing, not
 * cosmetic — see NEAR_MISS_REASONS.
 */
export type PairRejectionReason =
  | "parallel"
  | "overlap"
  | "not-material"
  | "variance"
  | "thickness"
  | "pour";

/**
 * The only reasons that describe a REAL candidate. 'parallel', 'overlap' and
 * 'not-material' knock out the arbitrary segment pairs the O(n²) sweep throws
 * up — two walls on opposite sides of a room are not a failed wall, they are
 * two walls — so they must never reach the user as a pairing failure.
 */
const NEAR_MISS_REASONS: ReadonlySet<PairRejectionReason> = new Set([
  "variance",
  "thickness",
  "pour",
]);

/**
 * Whether a rejection is worth telling the user about.
 *
 * Thickness bounds the caller named explicitly are the documented way to say
 * "read this hall and the room inside it as two rooms, not one thick wall".
 * Honouring that request and then warning that the pairing failed would cry
 * wolf on every courtyard, so an explicit bound rejects quietly.
 */
function isNearMiss(reason: PairRejectionReason, options: ResolvedOptions): boolean {
  if (reason === "thickness" && options.thicknessBoundsAreExplicit) return false;
  return NEAR_MISS_REASONS.has(reason);
}

/** A pair that got as far as looking like one wall and was then turned down. */
export interface PairNearMiss {
  edgeAId: string;
  edgeBId: string;
  regionId: string;
  reason: PairRejectionReason;
  overlapCm: number;
  measuredThicknessCm: number;
}

export interface PairFacesResult {
  pairings: FacePairing[];
  coverageByRegionId: Map<string, number>;
  /** real candidates that were rejected, so a failure is never silent */
  nearMisses: PairNearMiss[];
}

export interface PairFacesContext {
  /** thickness the user typed on the wall behind each edge */
  declaredThicknessByEdgeId: Map<string, number>;
  /** the pour each edge's wall belongs to */
  pourIdByEdgeId: Map<string, string>;
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
  options: ResolvedOptions,
  context: PairFacesContext = { declaredThicknessByEdgeId: new Map(), pourIdByEdgeId: new Map() }
): PairFacesResult {
  const pointByNodeId = new Map(nodes.map((n) => [n.id, n.point]));
  const cycleById = new Map(faces.cycles.map((c) => [c.id, c] as const));
  const polygonOf = (cycleId: string): Point[] =>
    (cycleById.get(cycleId)?.nodeIds ?? []).map((id) => pointByNodeId.get(id)!).filter(Boolean);

  const pairings: FacePairing[] = [];
  const coverageByRegionId = new Map<string, number>();
  const nearMisses: PairNearMiss[] = [];

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

        const result = evaluate(a, b, region.id, options, context, insideRegion);
        if (!result.ok) {
          if (isNearMiss(result.reason, options)) {
            nearMisses.push({
              edgeAId: a.edgeId,
              edgeBId: b.edgeId,
              regionId: region.id,
              reason: result.reason,
              overlapCm: result.overlapCm,
              measuredThicknessCm: result.measuredThicknessCm,
            });
          }
          continue;
        }
        candidates.push(result.pairing);
        dartIdByPairing.set(result.pairing, [a.dartId, b.dartId]);
      }
    }

    // A separation the engineer actually typed outranks a merely longer run:
    // on a dense plan the greedy claim below would otherwise let a long
    // opposite wall grab the dart before the real far face gets a turn.
    candidates.sort(
      (x, y) =>
        Number(y.declaredMatch) - Number(x.declaredMatch) ||
        y.overlapCm - x.overlapCm ||
        x.thicknessVarianceCm - y.thicknessVarianceCm ||
        (x.edgeAId < y.edgeAId ? -1 : 1)
    );

    const claimed = new Set<string>();
    for (const candidate of candidates) {
      const [dartA, dartB] = dartIdByPairing.get(candidate)!;
      if (claimed.has(dartA) || claimed.has(dartB)) continue;
      claimed.add(dartA);
      claimed.add(dartB);
      pairings.push(candidate);
    }

    coverageByRegionId.set(
      region.id,
      segments.length > 0 ? claimed.size / segments.length : 0
    );
  }

  return { pairings, coverageByRegionId, nearMisses };
}

type EvaluateResult =
  | { ok: true; pairing: FacePairing }
  | {
      ok: false;
      reason: PairRejectionReason;
      overlapCm: number;
      measuredThicknessCm: number;
    };

/**
 * The gates run in a fixed order, and that order is what makes the two
 * rejection groups meaningful: everything up to and including the
 * material-between test decides whether these two segments are a candidate at
 * all, and only what comes after can turn a real candidate down.
 */
function evaluate(
  a: RegionSegment,
  b: RegionSegment,
  regionId: string,
  options: ResolvedOptions,
  context: PairFacesContext,
  insideRegion: (p: Point) => boolean
): EvaluateResult {
  const reject = (
    reason: PairRejectionReason,
    overlapCm = 0,
    measuredThicknessCm = 0
  ): EvaluateResult => ({ ok: false, reason, overlapCm, measuredThicknessCm });

  const angle = angleBetweenDeg(a.line, b.line);
  const offParallel = Math.min(angle, 180 - angle);
  if (offParallel > options.parallelToleranceDeg) return reject("parallel");

  const overlap = projectedOverlap(a.line, b.line);
  if (!overlap) return reject("overlap");
  const overlapCm = overlap[1] - overlap[0];
  const required = Math.max(
    options.minOverlapCm,
    options.minOverlapFraction * Math.min(a.length, b.length)
  );
  if (overlapCm < required) return reject("overlap", overlapCm);

  const samples = SAMPLE_FRACTIONS.map((fraction) =>
    pointAlong(a.line, overlap[0] + fraction * overlapCm)
  );
  const distances = samples.map((p) => perpendicularDistance(p, b.line));
  const mean = distances.reduce((sum, d) => sum + d, 0) / distances.length;
  const variance = Math.max(...distances) - Math.min(...distances);

  // The material has to actually lie between them: without this, two walls on
  // opposite sides of a narrow room would pair straight through the room.
  const middle = samples[1]!;
  const opposite = closestPointOnLine(middle, b.line);
  const strip = { x: (middle.x + opposite.x) / 2, y: (middle.y + opposite.y) / 2 };
  if (!insideRegion(strip)) return reject("not-material", overlapCm, mean);

  // ── past here the two segments genuinely look like one wall ──

  if (variance > varianceLimitFor(mean, options.thicknessVarianceCm)) {
    return reject("variance", overlapCm, mean);
  }

  // Two faces of one physical wall are poured together by definition. Pairing
  // across pours would move one face's panels and quantities into the other
  // pour's column, which is worse than showing the user two walls.
  const pourA = context.pourIdByEdgeId.get(a.edgeId);
  const pourB = context.pourIdByEdgeId.get(b.edgeId);
  if (pourA !== undefined && pourB !== undefined && pourA !== pourB) {
    return reject("pour", overlapCm, mean);
  }

  const declaredMatch = matchesDeclaredThickness(a, b, mean, options, context);
  // A thickness the engineer typed settles what counts as plausible for THIS
  // wall — but only that, and only against our own default band. Bounds the
  // caller named explicitly are an instruction and outrank the drawing.
  const boundsApply = !declaredMatch || options.thicknessBoundsAreExplicit;
  if (boundsApply && (mean < options.minThicknessCm || mean > options.maxThicknessCm)) {
    return reject("thickness", overlapCm, mean);
  }

  const flags: string[] = [];
  if (overlapCm < a.length - 1e-6 || overlapCm < b.length - 1e-6) flags.push("partial-overlap");

  return {
    ok: true,
    pairing: {
      edgeAId: a.edgeId,
      edgeBId: b.edgeId,
      betweenRegionId: regionId,
      measuredThicknessCm: mean,
      thicknessVarianceCm: variance,
      overlapCm,
      aToBSign: signFromAToB(a, b),
      declaredMatch,
      flags,
    },
  };
}

function matchesDeclaredThickness(
  a: RegionSegment,
  b: RegionSegment,
  mean: number,
  options: ResolvedOptions,
  context: PairFacesContext
): boolean {
  const tolerance = options.declaredThicknessToleranceCm;
  return [a.edgeId, b.edgeId].some((edgeId) => {
    const declared = context.declaredThicknessByEdgeId.get(edgeId);
    return declared !== undefined && Math.abs(mean - declared) <= tolerance;
  });
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
