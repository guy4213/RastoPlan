import type { Point } from "@rastoplan/core";
import { bandFromCorners, bandOverlap, type PlacementBand } from "./geometry.js";

/**
 * One label the canvas or the print SVG wants to draw: a text anchor plus
 * enough of its geometry to estimate the box it will occupy.
 *
 * `anchor` and `fontSizeCm` are in the SAME world unit the caller is working
 * in — centimetres for the Konva canvas. The print layer works in world cm
 * too (it only converts to millimetres at the very last step, when it writes
 * SVG coordinates), so both renderers can hand this one solver comparable
 * numbers instead of each shipping its own overlap math.
 */
export interface LabelCandidate {
  id: string;
  anchor: Point;
  rotationDeg: number;
  /** Used only for its length (an exact glyph metric is not the point —
   * see CHAR_WIDTH_FACTOR below). */
  text: string;
  fontSizeCm: number;
  /** Direction to nudge the label along when it collides with one already
   * placed. Does not need to be a unit vector — this function normalises it;
   * the zero vector falls back to {1, 0} so a degenerate wall still resolves
   * to a valid box instead of collapsing it. */
  pushDir: Point;
  /** Higher goes first. Ties broken by `id` so the result is stable and
   * independent of input array order. */
  priority: number;
  /**
   * An obstacle, not something to place: it stays exactly where it is and the
   * movable labels route around it. A panel's own label belongs to that panel
   * — sliding it off its band to make room would be worse than the collision
   * it was avoiding — so it goes in as fixed rather than being left out, which
   * is what let a length label land on top of `עץ 351` in the printed plan.
   */
  fixed?: boolean;
}

export interface PlacedLabel {
  x: number;
  y: number;
  rotationDeg: number;
}

/** Rough glyph metrics, good enough for collision purposes — see module doc
 * on why an estimate is the right tool here, not a typesetting pass. */
const CHAR_WIDTH_FACTOR = 0.6;
const LINE_HEIGHT_FACTOR = 1.2;

/** Up to 3 pushes along the candidate's own normal, then up to 3 slides
 * along the tangent — a fixed, small budget so a genuinely crowded corner
 * still terminates instead of hunting forever for a free spot that may not
 * exist. */
const MAX_PUSH_ATTEMPTS = 3;
const MAX_TANGENT_ATTEMPTS = 3;

/** Below this, two boxes are treated as merely touching, not overlapping —
 * matches the tolerance panelOverlapRects (geometry.ts) already uses for the
 * same kind of near-zero floating point sliver. */
const OVERLAP_EPSILON_CM = 0.01;

function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function boxHalfExtents(candidate: LabelCandidate): { halfWidth: number; halfHeight: number } {
  const charCount = Math.max(1, candidate.text.length);
  return {
    halfWidth: (charCount * candidate.fontSizeCm * CHAR_WIDTH_FACTOR) / 2,
    halfHeight: (candidate.fontSizeCm * LINE_HEIGHT_FACTOR) / 2,
  };
}

/** Corners of the (possibly rotated) text box, in world coordinates. */
function boxCorners(
  center: Point,
  halfWidth: number,
  halfHeight: number,
  rotationDeg: number
): [Point, Point, Point, Point] {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local: Array<[number, number]> = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ];
  return local.map(([lx, ly]) => ({
    x: center.x + lx * cos - ly * sin,
    y: center.y + lx * sin + ly * cos,
  })) as [Point, Point, Point, Point];
}

/** The candidate's axis-aligned bounding box at a given center, reusing
 * geometry.ts's bandFromCorners rather than re-deriving an AABB-of-a-rotated-
 * rectangle formula that already exists and is already tested there. */
function bandAt(center: Point, candidate: LabelCandidate): PlacementBand {
  const { halfWidth, halfHeight } = boxHalfExtents(candidate);
  return bandFromCorners(boxCorners(center, halfWidth, halfHeight, candidate.rotationDeg));
}

/** Same "both axes must overlap" rule geometry.ts's panelOverlapRects uses
 * on top of bandOverlap — bandOverlap itself only reports the per-axis
 * overlap amount, not a yes/no. */
function overlapsAny(box: PlacementBand, placed: PlacementBand[]): boolean {
  return placed.some((other) => {
    const overlap = bandOverlap(box, other);
    return overlap.x > OVERLAP_EPSILON_CM && overlap.y > OVERLAP_EPSILON_CM;
  });
}

/**
 * Greedy, deterministic label placement.
 *
 * Highest-priority candidate first (ties broken by id, so the result never
 * depends on array order), each one kept at its own anchor unless that would
 * overlap a label already placed — in which case it is nudged along its own
 * push direction, and if that alone is not enough, along the perpendicular
 * (tangent) direction, a fixed handful of times before it is accepted
 * wherever it landed. A candidate with no room left simply keeps the last
 * position it tried rather than looping indefinitely.
 *
 * Pure and Konva/DOM free: box sizes are ESTIMATED from character count and
 * font size, which is what keeps this unit-testable without a real text
 * layout engine — good enough to decide whether two labels collide.
 */
export function layoutLabels(candidates: LabelCandidate[]): Map<string, PlacedLabel> {
  const result = new Map<string, PlacedLabel>();
  const placedBands: PlacementBand[] = [];

  // Obstacles are registered before anything movable is considered, so they
  // constrain every placement regardless of priority.
  for (const candidate of candidates) {
    if (!candidate.fixed) continue;
    placedBands.push(bandAt(candidate.anchor, candidate));
    result.set(candidate.id, {
      x: candidate.anchor.x,
      y: candidate.anchor.y,
      rotationDeg: candidate.rotationDeg,
    });
  }

  const ordered = candidates
    .filter((c) => !c.fixed)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });

  for (const candidate of ordered) {
    const pushDir = normalize(candidate.pushDir);
    const tangent = { x: -pushDir.y, y: pushDir.x };
    // One text-line height: proportionate to the label's own font size
    // rather than a fixed pixel constant, so the same code works whether the
    // caller is in canvas cm-per-pixel space or the print layer's cm space.
    const stepCm = candidate.fontSizeCm * LINE_HEIGHT_FACTOR;

    let center = candidate.anchor;
    let band = bandAt(center, candidate);

    for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS && overlapsAny(band, placedBands); attempt++) {
      center = {
        x: candidate.anchor.x + pushDir.x * stepCm * attempt,
        y: candidate.anchor.y + pushDir.y * stepCm * attempt,
      };
      band = bandAt(center, candidate);
    }

    for (
      let attempt = 1;
      attempt <= MAX_TANGENT_ATTEMPTS && overlapsAny(band, placedBands);
      attempt++
    ) {
      const sign = attempt % 2 === 1 ? 1 : -1;
      const magnitude = Math.ceil(attempt / 2);
      center = {
        x:
          candidate.anchor.x +
          pushDir.x * stepCm * MAX_PUSH_ATTEMPTS +
          tangent.x * stepCm * magnitude * sign,
        y:
          candidate.anchor.y +
          pushDir.y * stepCm * MAX_PUSH_ATTEMPTS +
          tangent.y * stepCm * magnitude * sign,
      };
      band = bandAt(center, candidate);
    }

    placedBands.push(band);
    result.set(candidate.id, { x: center.x, y: center.y, rotationDeg: candidate.rotationDeg });
  }

  return result;
}
