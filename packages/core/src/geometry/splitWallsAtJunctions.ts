import type { Point, Wall } from "../types.js";
import { SNAP_TOLERANCE_CM } from "./buildGraph.js";

export interface SplitWallsAtJunctionsResult {
  walls: Wall[];
  /** True when an endpoint was snapped or at least one wall was split. */
  changed: boolean;
}

interface Projection {
  point: Point;
  t: number;
  distance: number;
}

interface EndpointSnap extends Projection {
  targetWallIndex: number;
}

const EPSILON = 1e-9;
// Keep a tiny numerical buffer around the graph's own merge radius. A point
// calculated 2.009cm from a corner is still the same corner in practice;
// splitting there would manufacture a near-zero edge.
const END_MARGIN_EPSILON_CM = 0.05;

/**
 * Makes a user drawing planar before it enters the graph engine.
 *
 * A CAD user naturally draws a room perimeter as four long lines and then
 * finishes a partition on the middle of two of those lines. `buildGraph`
 * deliberately has a one-wall/one-edge contract, so an endpoint touching the
 * middle of a wall cannot become a T node until that long wall is represented
 * by two saved wall segments. This function performs exactly that normalisation:
 *
 * - endpoints within `toleranceCm` of another segment snap onto it;
 * - the segment under that endpoint is split at the contact point;
 * - proper segment crossings split both participants;
 * - all wall properties (pour, thickness and inventory-facing identity of the
 *   first part) are preserved.
 *
 * It is idempotent. Once the junctions are endpoints, running it again returns
 * the same array unchanged.
 */
export function splitWallsAtJunctions(
  inputWalls: Wall[],
  toleranceCm = SNAP_TOLERANCE_CM
): SplitWallsAtJunctionsResult {
  if (inputWalls.length < 2) return { walls: inputWalls, changed: false };

  const lines = inputWalls.map((wall) => [
    { ...wall.innerLine[0] },
    { ...wall.innerLine[1] },
  ] as [Point, Point]);
  const endpointSnaps = new Map<string, EndpointSnap>();

  // Pick the single nearest segment for each endpoint. Endpoint-to-endpoint
  // merging remains buildGraph's job; only a projection genuinely inside the
  // other segment belongs here.
  for (let sourceIndex = 0; sourceIndex < lines.length; sourceIndex++) {
    for (const endIndex of [0, 1] as const) {
      const point = lines[sourceIndex]![endIndex];
      let best: EndpointSnap | undefined;

      for (let targetIndex = 0; targetIndex < lines.length; targetIndex++) {
        if (sourceIndex === targetIndex) continue;
        const projection = projectToSegment(point, lines[targetIndex]!);
        if (!projection || projection.distance > toleranceCm) continue;
        if (!isInteriorProjection(projection, lines[targetIndex]!, toleranceCm)) continue;
        if (!best || projection.distance < best.distance - EPSILON) {
          best = { ...projection, targetWallIndex: targetIndex };
        }
      }

      if (best) endpointSnaps.set(`${sourceIndex}:${endIndex}`, best);
    }
  }

  let changed = false;
  for (const [key, snap] of endpointSnaps) {
    const [wallIndexText, endIndexText] = key.split(":");
    const wallIndex = Number(wallIndexText);
    const endIndex = Number(endIndexText) as 0 | 1;
    const before = lines[wallIndex]![endIndex];
    if (pointDistance(before, snap.point) > EPSILON) changed = true;
    lines[wallIndex]![endIndex] = { ...snap.point };
  }

  const cutsByWall = lines.map(() => [] as Point[]);
  for (const snap of endpointSnaps.values()) {
    cutsByWall[snap.targetWallIndex]!.push(snap.point);
  }

  // After endpoint snapping, find real crossings as well. This handles a line
  // dragged straight through an existing wall, not just a line that terminates
  // on it.
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const crossing = segmentIntersection(lines[i]!, lines[j]!);
      if (!crossing) continue;
      if (isFarEnoughFromEnds(crossing.point, lines[i]!, toleranceCm)) {
        cutsByWall[i]!.push(crossing.point);
      }
      if (isFarEnoughFromEnds(crossing.point, lines[j]!, toleranceCm)) {
        cutsByWall[j]!.push(crossing.point);
      }
    }
  }

  const occupiedIds = new Set(inputWalls.map((wall) => wall.id));
  const walls: Wall[] = [];

  for (let wallIndex = 0; wallIndex < inputWalls.length; wallIndex++) {
    const wall = inputWalls[wallIndex]!;
    const line = lines[wallIndex]!;
    const length = pointDistance(line[0], line[1]);
    const cuts = cutsByWall[wallIndex]!
      .map((point) => ({ point, t: parameterOnLine(point, line) }))
      .filter(({ t }) => t > EPSILON && t < 1 - EPSILON)
      .sort((a, b) => a.t - b.t);

    const uniqueCuts: Array<{ point: Point; t: number }> = [];
    for (const cut of cuts) {
      const previous = uniqueCuts.at(-1);
      if (previous && Math.abs(cut.t - previous.t) * length <= toleranceCm) continue;
      const endMargin = toleranceCm + END_MARGIN_EPSILON_CM;
      if (cut.t * length <= endMargin || (1 - cut.t) * length <= endMargin) continue;
      uniqueCuts.push(cut);
    }

    if (uniqueCuts.length === 0) {
      if (
        pointDistance(wall.innerLine[0], line[0]) <= EPSILON &&
        pointDistance(wall.innerLine[1], line[1]) <= EPSILON
      ) {
        walls.push(wall);
      } else {
        walls.push({ ...wall, innerLine: line });
      }
      continue;
    }

    changed = true;
    const points = [line[0], ...uniqueCuts.map((cut) => cut.point), line[1]];
    for (let partIndex = 0; partIndex < points.length - 1; partIndex++) {
      const id =
        partIndex === 0
          ? wall.id
          : allocatePartId(wall.id, partIndex + 1, occupiedIds);
      walls.push({
        ...wall,
        id,
        innerLine: [{ ...points[partIndex]! }, { ...points[partIndex + 1]! }],
      });
    }
  }

  return { walls: changed ? walls : inputWalls, changed };
}

function projectToSegment(point: Point, line: [Point, Point]): Projection | undefined {
  const [a, b] = line;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return undefined;
  const rawT = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = { x: a.x + dx * t, y: a.y + dy * t };
  return { point: projected, t, distance: pointDistance(point, projected) };
}

function isInteriorProjection(
  projection: Projection,
  line: [Point, Point],
  toleranceCm: number
): boolean {
  const length = pointDistance(line[0], line[1]);
  const margin = toleranceCm + END_MARGIN_EPSILON_CM;
  return projection.t * length > margin && (1 - projection.t) * length > margin;
}

function isFarEnoughFromEnds(
  point: Point,
  line: [Point, Point],
  toleranceCm: number
): boolean {
  const margin = toleranceCm + END_MARGIN_EPSILON_CM;
  return pointDistance(point, line[0]) > margin && pointDistance(point, line[1]) > margin;
}

function segmentIntersection(
  first: [Point, Point],
  second: [Point, Point]
): { point: Point; t: number; u: number } | undefined {
  const [a, b] = first;
  const [c, d] = second;
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = cross(rx, ry, sx, sy);
  if (Math.abs(denominator) <= EPSILON) return undefined;

  const qpx = c.x - a.x;
  const qpy = c.y - a.y;
  const t = cross(qpx, qpy, sx, sy) / denominator;
  const u = cross(qpx, qpy, rx, ry) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) {
    return undefined;
  }

  return { point: { x: a.x + rx * t, y: a.y + ry * t }, t, u };
}

function parameterOnLine(point: Point, line: [Point, Point]): number {
  const [a, b] = line;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return 0;
  return ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
}

function allocatePartId(baseId: string, partNumber: number, occupiedIds: Set<string>): string {
  let suffix = partNumber;
  let candidate = `${baseId}:part:${suffix}`;
  while (occupiedIds.has(candidate)) {
    suffix++;
    candidate = `${baseId}:part:${suffix}`;
  }
  occupiedIds.add(candidate);
  return candidate;
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}
