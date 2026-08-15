import type { Point, Wall } from "../types.js";
import { angleBetweenDeg, perpendicularDistance, pointAlong, projectedOverlap } from "../geometry/polygon.js";

/**
 * Reads each wall's real thickness off the drawing instead of applying one
 * typed-in number to everything.
 *
 * An architectural plan draws a wall as two lines — the inner face and the
 * outer face — so the thickness is already there, as the gap between a segment
 * and the parallel segment facing it. Importing with a fixed 20cm throws that
 * away, and it is not even close: in Drawing1.dwg pour A runs 20cm on its left
 * side and 30cm on its right.
 *
 * This is the same measurement `pairFaces` makes when it resolves contours; it
 * is done here too so the thickness is right the moment the walls land on the
 * canvas, before anything has been computed.
 */

/** Faces of one wall must be parallel within this. */
const PARALLEL_TOLERANCE_DEG = 2;
/** Below this the two lines are the same face drawn twice, not a wall. */
const MIN_THICKNESS_CM = 5;
/** Above this the "gap" is a room, not wall material. */
const MAX_THICKNESS_CM = 120;
/** The facing run must be at least this long to be a wall's other face. */
const MIN_OVERLAP_CM = 30;
/** ...and cover at least this much of the shorter segment. */
const MIN_OVERLAP_FRACTION = 0.5;
/** The gap must be this consistent along the run, or the lines are splaying. */
const MAX_VARIANCE_CM = 2;

/** Where along the shared run the separation is sampled. */
const SAMPLE_FRACTIONS = [0.15, 0.5, 0.85];

function lengthOf(line: [Point, Point]): number {
  return Math.hypot(line[1].x - line[0].x, line[1].y - line[0].y);
}

/**
 * The consistent perpendicular gap between two facing segments, or null when
 * they are not two faces of one wall.
 */
function facingDistance(a: [Point, Point], b: [Point, Point]): number | null {
  const angle = angleBetweenDeg(a, b);
  // Accept parallel and anti-parallel: contours are often traced opposite ways.
  const offParallel = Math.min(angle, 180 - angle);
  if (offParallel > PARALLEL_TOLERANCE_DEG) return null;

  const overlap = projectedOverlap(a, b);
  if (!overlap) return null;
  const overlapCm = overlap[1] - overlap[0];
  const required = Math.max(MIN_OVERLAP_CM, MIN_OVERLAP_FRACTION * Math.min(lengthOf(a), lengthOf(b)));
  if (overlapCm < required) return null;

  const distances = SAMPLE_FRACTIONS.map((f) =>
    perpendicularDistance(pointAlong(a, overlap[0] + f * overlapCm), b)
  );
  const mean = distances.reduce((sum, d) => sum + d, 0) / distances.length;
  if (Math.max(...distances) - Math.min(...distances) > MAX_VARIANCE_CM) return null;
  if (mean < MIN_THICKNESS_CM || mean > MAX_THICKNESS_CM) return null;

  return mean;
}

export interface MeasureThicknessResult {
  walls: Wall[];
  /** how many walls got a thickness measured off the drawing */
  measured: number;
}

/**
 * Returns the walls with `thickness` set from the geometry wherever a facing
 * face could be found, and left at its incoming value everywhere else.
 *
 * Only walls in the same pour are compared: two pours drawn side by side must
 * never measure each other.
 */
export function measureThickness(walls: Wall[], roundToCm = 1): MeasureThicknessResult {
  const byPour = new Map<string, Wall[]>();
  for (const wall of walls) {
    let group = byPour.get(wall.pourId);
    if (!group) byPour.set(wall.pourId, (group = []));
    group.push(wall);
  }

  const measuredById = new Map<string, number>();
  for (const group of byPour.values()) {
    for (const wall of group) {
      let best: number | null = null;
      for (const other of group) {
        if (other.id === wall.id) continue;
        const gap = facingDistance(wall.innerLine, other.innerLine);
        if (gap === null) continue;
        // The nearest facing line is the other face of this wall; anything
        // further is the far side of the room.
        if (best === null || gap < best) best = gap;
      }
      if (best !== null) measuredById.set(wall.id, best);
    }
  }

  const round = (n: number) => (roundToCm > 0 ? Math.round(n / roundToCm) * roundToCm : n);
  return {
    walls: walls.map((wall) => {
      const measured = measuredById.get(wall.id);
      return measured === undefined ? wall : { ...wall, thickness: round(measured) };
    }),
    measured: measuredById.size,
  };
}
