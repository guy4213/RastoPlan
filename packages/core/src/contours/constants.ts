export { STRAIGHT_JOIN_TOLERANCE_DEG } from "../geometry/classifyNodes.js";

/** Two candidate faces of one wall must be parallel (or anti-parallel) within this. */
export const CONTOUR_PARALLEL_TOLERANCE_DEG = 3;

/**
 * The band of separations that reads as a wall rather than as a gap between two
 * rooms. Below it the two lines are the same face drawn twice; above it they are
 * two different walls. The customer's plans sit at 20–30cm.
 */
export const MIN_PLAUSIBLE_WALL_THICKNESS_CM = 15;
export const MAX_PLAUSIBLE_WALL_THICKNESS_CM = 50;

/** How much the separation may wobble along the shared run before we refuse to pair. */
export const CONTOUR_THICKNESS_VARIANCE_CM = 2;

/** A shared run shorter than one corner panel tells us nothing. */
export const CONTOUR_MIN_OVERLAP_CM = 30;
/** ...and it must also cover this much of the shorter of the two segments. */
export const CONTOUR_MIN_OVERLAP_FRACTION = 0.6;

/** Fraction of a region's boundary that must be paired for it to be wall material. */
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
