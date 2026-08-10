import type { Point } from "../types.js";
import { cross2, distance, subtract } from "./vector.js";

/** Coordinates closer than this are the same point for boundary tests. */
const EPSILON = 1e-9;

/**
 * Ray-casting containment test. Points exactly on the boundary count as
 * inside — callers that need strict interiors (interiorSamplePoint) pair this
 * with isOnPolygonBoundary.
 *
 * Winding-agnostic on purpose: the same ring traced clockwise or
 * counter-clockwise encloses the same set of points, and the orientation
 * question is answered by signedArea, not here.
 */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  if (isOnPolygonBoundary(p, polygon)) return true;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

export function isOnPolygonBoundary(p: Point, polygon: Point[]): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    if (isOnSegment(p, a, b)) return true;
  }
  return false;
}

export function polygonPerimeter(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    sum += distance(polygon[i]!, polygon[(i + 1) % polygon.length]!);
  }
  return sum;
}

/**
 * A point strictly inside `polygon`, robust for concave rings (the centroid of
 * an L-shape can fall in the notch). Walks the vertices and nudges off each one
 * along its angle bisector, trying both directions and shrinking the nudge —
 * at any strictly convex vertex the inward bisector lands inside, and every
 * simple polygon has at least one. Falls back to the centroid.
 *
 * Returns null for degenerate rings (fewer than 3 distinct points, zero area).
 */
export function interiorSamplePoint(polygon: Point[], epsilonCm = 0.5): Point | null {
  if (polygon.length < 3) return null;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n]!;
    const curr = polygon[i]!;
    const next = polygon[(i + 1) % n]!;

    const u = normalize(subtract(prev, curr));
    const v = normalize(subtract(next, curr));
    if (!u || !v) continue;

    let direction = normalize({ x: u.x + v.x, y: u.y + v.y });
    // Collinear vertex: the bisector cancels out, so step perpendicular instead.
    if (!direction) direction = { x: -u.y, y: u.x };

    for (const sign of [1, -1] as const) {
      for (const eps of [epsilonCm, epsilonCm / 10, epsilonCm / 100]) {
        const candidate = {
          x: curr.x + direction.x * sign * eps,
          y: curr.y + direction.y * sign * eps,
        };
        if (isStrictlyInside(candidate, polygon)) return candidate;
      }
    }
  }

  const c = centroid(polygon);
  return c && isStrictlyInside(c, polygon) ? c : null;
}

export function isStrictlyInside(p: Point, polygon: Point[]): boolean {
  return !isOnPolygonBoundary(p, polygon) && pointInPolygon(p, polygon);
}

/** Direction of a→b in degrees, in (-180, 180]. */
export function segmentAngleDeg(a: Point, b: Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/**
 * Smallest angle between two segments' directions, in [0, 180]. 0 = parallel
 * and pointing the same way, 180 = anti-parallel — the pairing layer cares
 * about the difference, since two faces of one wall face each other.
 */
export function angleBetweenDeg(a: [Point, Point], b: [Point, Point]): number {
  const raw = segmentAngleDeg(b[0], b[1]) - segmentAngleDeg(a[0], a[1]);
  const wrapped = ((raw % 360) + 360) % 360;
  return wrapped > 180 ? 360 - wrapped : wrapped;
}

/**
 * The stretch of `a` that `b` projects onto, as [from, to] in cm measured from
 * a[0] along a's direction, clipped to a's own extent. Null when they don't
 * overlap at all.
 */
export function projectedOverlap(
  a: [Point, Point],
  b: [Point, Point]
): [number, number] | null {
  const axis = subtract(a[1], a[0]);
  const length = Math.hypot(axis.x, axis.y);
  if (length < EPSILON) return null;

  const u = { x: axis.x / length, y: axis.y / length };
  const project = (p: Point) => (p.x - a[0].x) * u.x + (p.y - a[0].y) * u.y;

  const projections = [project(b[0]), project(b[1])].sort((x, y) => x - y);
  const from = Math.max(0, projections[0]!);
  const to = Math.min(length, projections[1]!);
  return to > from ? [from, to] : null;
}

/** Perpendicular distance from `p` to the infinite line through `line`. */
export function perpendicularDistance(p: Point, line: [Point, Point]): number {
  const d = subtract(line[1], line[0]);
  const length = Math.hypot(d.x, d.y);
  if (length < EPSILON) return distance(p, line[0]);
  return Math.abs(cross2(d, subtract(p, line[0]))) / length;
}

/** Foot of the perpendicular from `p` onto the infinite line through `line`. */
export function closestPointOnLine(p: Point, line: [Point, Point]): Point {
  const d = subtract(line[1], line[0]);
  const lengthSquared = d.x * d.x + d.y * d.y;
  if (lengthSquared < EPSILON) return { ...line[0] };
  const t = ((p.x - line[0].x) * d.x + (p.y - line[0].y) * d.y) / lengthSquared;
  return { x: line[0].x + d.x * t, y: line[0].y + d.y * t };
}

/** The point `t` cm along `line` from its first endpoint. */
export function pointAlong(line: [Point, Point], t: number): Point {
  const d = subtract(line[1], line[0]);
  const length = Math.hypot(d.x, d.y);
  if (length < EPSILON) return { ...line[0] };
  return { x: line[0].x + (d.x / length) * t, y: line[0].y + (d.y / length) * t };
}

/**
 * Unit perpendicular to a→b, in the (dy, -dx) frame the whole codebase uses
 * for wall normals (web/src/canvas/geometry.ts:wallNormal, deriveOuterLine's
 * OuterSide). Keeping one convention is what makes outward signs comparable
 * between core and the canvas.
 */
export function unitNormal(a: Point, b: Point): Point | null {
  const d = normalize(subtract(b, a));
  return d ? { x: d.y, y: -d.x } : null;
}

function centroid(polygon: Point[]): Point | null {
  if (polygon.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of polygon) {
    x += p.x;
    y += p.y;
  }
  return { x: x / polygon.length, y: y / polygon.length };
}

function normalize(v: Point): Point | null {
  const length = Math.hypot(v.x, v.y);
  if (length < EPSILON) return null;
  return { x: v.x / length, y: v.y / length };
}

function isOnSegment(p: Point, a: Point, b: Point): boolean {
  const d = subtract(b, a);
  const length = Math.hypot(d.x, d.y);
  if (length < EPSILON) return distance(p, a) < EPSILON;
  if (Math.abs(cross2(d, subtract(p, a))) / length > 1e-7) return false;
  const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (length * length);
  return t >= -1e-9 && t <= 1 + 1e-9;
}
