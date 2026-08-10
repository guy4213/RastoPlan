export { STRAIGHT_JOIN_TOLERANCE_DEG } from "../geometry/classifyNodes.js";

/** Two candidate faces of one wall must be parallel (or anti-parallel) within this. */
export const CONTOUR_PARALLEL_TOLERANCE_DEG = 3;

/**
 * Below this the two lines are the same face drawn twice, not a wall.
 */
export const MIN_PLAUSIBLE_WALL_THICKNESS_CM = 15;

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

/** How much the separation may wobble along the shared run before we refuse to pair. */
export const CONTOUR_THICKNESS_VARIANCE_CM = 2;

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
  thicknessVarianceCm: number;
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
    thicknessVarianceCm: options.thicknessVarianceCm ?? CONTOUR_THICKNESS_VARIANCE_CM,
    minOverlapCm: options.minOverlapCm ?? CONTOUR_MIN_OVERLAP_CM,
    minOverlapFraction: options.minOverlapFraction ?? CONTOUR_MIN_OVERLAP_FRACTION,
    materialMinCoverage: options.materialMinCoverage ?? REGION_MATERIAL_MIN_COVERAGE,
    materialAmbiguousCoverage:
      options.materialAmbiguousCoverage ?? REGION_MATERIAL_AMBIGUOUS_COVERAGE,
  };
}
