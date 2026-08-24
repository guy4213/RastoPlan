import { SNAP_TOLERANCE_CM } from "../geometry/buildGraph.js";

export { STRAIGHT_JOIN_TOLERANCE_DEG } from "../geometry/classifyNodes.js";

/** Two candidate faces of one wall must be parallel (or anti-parallel) within this. */
export const CONTOUR_PARALLEL_TOLERANCE_DEG = 3;

/**
 * The floor below which the geometry engine cannot tell two lines apart at all:
 * buildGraph snaps endpoints within SNAP_TOLERANCE_CM, so once the contours are
 * closer than two of those their corner nodes fuse and there is no ring left to
 * reason about. Anything above it is a wall, however thin.
 *
 * This is deliberately a TECHNICAL floor, not an engineering one. It used to be
 * 15cm — "below this the two lines are the same face drawn twice" — which threw
 * away every genuinely thin wall: the pairing failed, nothing was consumed, and
 * the plan came back with two independent wall sets and double the BOM. That
 * also contradicted the reasoning right below, which had already concluded that
 * the drawing convention decides, not the measured distance.
 */
export const GEOMETRY_RESOLUTION_FLOOR_CM = 2 * SNAP_TOLERANCE_CM;

export const MIN_PLAUSIBLE_WALL_THICKNESS_CM = GEOMETRY_RESOLUTION_FLOOR_CM;

/**
 * How far the measured separation may sit from a thickness the user actually
 * typed before that stops counting as confirmation. A match here overrides the
 * plausible-thickness band and NOTHING else — the engineer saying "this wall is
 * 12cm" settles what counts as plausible, but it cannot make two lines parallel,
 * overlapping, evenly spaced, or part of the same pour.
 */
export const DECLARED_THICKNESS_TOLERANCE_CM = 2;

/**
 * There is deliberately NO default ceiling. The customer traces a room as two
 * nested contours — outer face and inner face — and that convention, not the
 * measured distance, is what says "this is one wall". A ceiling made a plan
 * drawn out of scale silently come back as two rooms with four rings of panels
 * instead of one wall with two.
 *
 * The cost: a hall with a free-standing room inside it is geometrically
 * identical to one thick wall ring, so it reads as a wall by default. Pass
 * `maxThicknessCm` to get the other reading.
 */
export const MAX_PLAUSIBLE_WALL_THICKNESS_CM = Infinity;

/**
 * How much the separation may wobble along the shared run before we refuse to
 * pair. Capped relative to the separation itself by `varianceLimitFor` — 2cm of
 * drift across a 20cm wall is drafting noise, but across a 5cm wall it is most
 * of the wall.
 */
export const CONTOUR_THICKNESS_VARIANCE_CM = 2;

/** Fraction of the measured separation the wobble may reach on a thin wall. */
export const CONTOUR_THICKNESS_VARIANCE_FRACTION = 0.2;

/** Never tighten below this — sub-millimetre wobble is float noise, not drift. */
export const CONTOUR_THICKNESS_VARIANCE_FLOOR_CM = 0.5;

/**
 * The wobble actually allowed at a given separation. Identical to the flat
 * `thicknessVarianceCm` from 10cm up, so nothing that paired before changes.
 */
export function varianceLimitFor(meanCm: number, thicknessVarianceCm: number): number {
  return Math.min(
    thicknessVarianceCm,
    Math.max(CONTOUR_THICKNESS_VARIANCE_FLOOR_CM, CONTOUR_THICKNESS_VARIANCE_FRACTION * meanCm)
  );
}

/** A shared run shorter than one corner panel tells us nothing. */
export const CONTOUR_MIN_OVERLAP_CM = 30;
/** ...and it must also cover this much of the shorter of the two segments. */
export const CONTOUR_MIN_OVERLAP_FRACTION = 0.6;

/**
 * Fraction of a region's boundary SEGMENTS that must be paired for it to be
 * wall material. Counted per segment rather than per centimetre on purpose:
 * the outer contour of a thick ring is much longer than the inner one, so a
 * length-weighted score quietly punishes exactly the thick walls it should
 * accept.
 */
export const REGION_MATERIAL_MIN_COVERAGE = 0.8;
/** Between this and MIN_COVERAGE the region is reported as ambiguous, not decided. */
export const REGION_MATERIAL_AMBIGUOUS_COVERAGE = 0.4;

/** Disagreement between the two faces' clear runs that gets flagged. */
export const FACE_RUN_MISMATCH_TOLERANCE_CM = 2;

/** Difference between measured and hand-entered thickness worth telling the user about. */
export const THICKNESS_MISMATCH_TOLERANCE_CM = 2;

export const POINT_IN_POLYGON_EPSILON_CM = 0.5;

/** Rings smaller than this are drawing noise, not regions. */
export const DEGENERATE_AREA_CM2 = 1;

export interface ResolveOptions {
  straightJoinToleranceDeg?: number;
  parallelToleranceDeg?: number;
  minThicknessCm?: number;
  maxThicknessCm?: number;
  thicknessVarianceCm?: number;
  declaredThicknessToleranceCm?: number;
  minOverlapCm?: number;
  minOverlapFraction?: number;
  materialMinCoverage?: number;
  materialAmbiguousCoverage?: number;
}

export interface ResolvedOptions {
  straightJoinToleranceDeg: number;
  parallelToleranceDeg: number;
  minThicknessCm: number;
  maxThicknessCm: number;
  /**
   * The caller named the bounds itself, so they are an instruction rather than
   * our own guess at what is plausible — and a thickness the user typed is not
   * allowed to override them. This is what keeps `maxThicknessCm` working as
   * the documented way to read a hall-with-a-room-inside as two rooms.
   */
  thicknessBoundsAreExplicit: boolean;
  thicknessVarianceCm: number;
  declaredThicknessToleranceCm: number;
  minOverlapCm: number;
  minOverlapFraction: number;
  materialMinCoverage: number;
  materialAmbiguousCoverage: number;
}

export function withDefaults(options: ResolveOptions = {}): ResolvedOptions {
  return {
    straightJoinToleranceDeg: options.straightJoinToleranceDeg ?? 8,
    parallelToleranceDeg: options.parallelToleranceDeg ?? CONTOUR_PARALLEL_TOLERANCE_DEG,
    minThicknessCm: options.minThicknessCm ?? MIN_PLAUSIBLE_WALL_THICKNESS_CM,
    maxThicknessCm: options.maxThicknessCm ?? MAX_PLAUSIBLE_WALL_THICKNESS_CM,
    thicknessBoundsAreExplicit:
      options.minThicknessCm !== undefined || options.maxThicknessCm !== undefined,
    thicknessVarianceCm: options.thicknessVarianceCm ?? CONTOUR_THICKNESS_VARIANCE_CM,
    declaredThicknessToleranceCm:
      options.declaredThicknessToleranceCm ?? DECLARED_THICKNESS_TOLERANCE_CM,
    minOverlapCm: options.minOverlapCm ?? CONTOUR_MIN_OVERLAP_CM,
    minOverlapFraction: options.minOverlapFraction ?? CONTOUR_MIN_OVERLAP_FRACTION,
    materialMinCoverage: options.materialMinCoverage ?? REGION_MATERIAL_MIN_COVERAGE,
    materialAmbiguousCoverage:
      options.materialAmbiguousCoverage ?? REGION_MATERIAL_AMBIGUOUS_COVERAGE,
  };
}
