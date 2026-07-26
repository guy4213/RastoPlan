import type { Point, Wall } from "@rastoplan/core";

/** Length of a wall's inner line in cm. */
export function wallLength(wall: Wall): number {
  const [a, b] = wall.innerLine;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Unit vector along the wall's A→B direction. */
export function wallDirection(wall: Wall): Point {
  const [a, b] = wall.innerLine;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return { x: 1, y: 0 };
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** Unit perpendicular to A→B (rotated 90° CW in screen coords). */
export function wallNormal(wall: Wall): Point {
  const d = wallDirection(wall);
  return { x: d.y, y: -d.x };
}

/**
 * A placement's world-space rectangle corners on a given side of the wall.
 * `sideSign` = +1 places the rect on the +normal side, -1 on the -normal.
 * We anchor the rectangle to the inner line and extend it outward by the
 * band's `depthCm` (a small visual thickness so placements don't overlap
 * the wall stroke).
 */
export function placementCorners(
  wall: Wall,
  offsetAlongEdge: number,
  width: number,
  sideSign: 1 | -1,
  depthCm: number
): [Point, Point, Point, Point] {
  const [a] = wall.innerLine;
  const d = wallDirection(wall);
  const n = wallNormal(wall);
  const start = {
    x: a.x + d.x * offsetAlongEdge + n.x * sideSign * 0,
    y: a.y + d.y * offsetAlongEdge + n.y * sideSign * 0,
  };
  const end = {
    x: start.x + d.x * width,
    y: start.y + d.y * width,
  };
  const outward = { x: n.x * sideSign * depthCm, y: n.y * sideSign * depthCm };
  return [
    start,
    end,
    { x: end.x + outward.x, y: end.y + outward.y },
    { x: start.x + outward.x, y: start.y + outward.y },
  ];
}

/**
 * Nearest existing wall endpoint within `endpointSnapCm`, or null. Kept
 * separate from snapEndpoint so callers can render a visual target hint
 * (a highlighted circle) without re-implementing the search.
 */
export function findEndpointSnapTarget(
  candidate: Point,
  walls: Wall[],
  endpointSnapCm: number
): Point | null {
  let best: { d: number; p: Point } | null = null;
  for (const w of walls) {
    for (const p of w.innerLine) {
      const d = Math.hypot(p.x - candidate.x, p.y - candidate.y);
      if (d <= endpointSnapCm && (best === null || d < best.d)) {
        best = { d, p };
      }
    }
  }
  return best ? best.p : null;
}

/**
 * Snap a candidate wall endpoint (in cm) to the nearest of:
 * 1. an existing wall endpoint (within `endpointSnapCm`) — returned
 *    verbatim so the new wall shares the exact vertex coordinate;
 * 2. an axis-aligned direction from `origin` (if origin provided) — the
 *    stronger axis wins so the user gets a horizontal or vertical wall
 *    almost automatically.
 */
export function snapEndpoint(
  candidate: Point,
  walls: Wall[],
  origin: Point | null,
  endpointSnapCm: number
): Point {
  const target = findEndpointSnapTarget(candidate, walls, endpointSnapCm);
  if (target) return target;

  if (origin) {
    const dx = Math.abs(candidate.x - origin.x);
    const dy = Math.abs(candidate.y - origin.y);
    if (dx > dy) return { x: candidate.x, y: origin.y };
    return { x: origin.x, y: candidate.y };
  }
  return candidate;
}

/**
 * Screen-pixel snap radius for endpoint targeting. Converting to cm at
 * the call site (via 1 / scale) keeps the "hot zone" the same visual
 * size regardless of zoom — otherwise it's unreachable when zoomed out.
 */
export const ENDPOINT_SNAP_PIXELS = 16;

