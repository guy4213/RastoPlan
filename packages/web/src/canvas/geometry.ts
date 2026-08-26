import type { Placement, Point, ProjectLayout, Wall } from "@rastoplan/core";

/**
 * With the ortho lock on, collapse the drag to the dominant axis so the wall is
 * strictly horizontal or vertical relative to `start` — the CAD "ortho" lock
 * users expect. Passthrough otherwise, which lets the user draw at any angle.
 *
 * The lock is a sticky mode (ui.orthoLock), not a held key: a run of orthogonal
 * walls used to mean holding Shift the whole way, and releasing it between
 * segments quietly produced one that was a degree off.
 */
export function applyAxisLock(start: Point, end: Point, locked: boolean): Point {
  if (!locked) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: end.x, y: start.y };
  return { x: start.x, y: end.y };
}

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
  // Prefer a real endpoint whenever one is reachable. Near a corner, snapping
  // to the adjoining segment would manufacture a tiny wall part.
  if (best) return best.p;

  // A partition normally ends on the middle of a perimeter wall. Make that
  // point just as magnetic as a corner; the reducer then splits the wall there
  // so the engine receives a real T node.
  for (const wall of walls) {
    const [a, b] = wall.innerLine;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const t = ((candidate.x - a.x) * dx + (candidate.y - a.y) * dy) / lengthSquared;
    if (t <= 0 || t >= 1) continue;
    const projected = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(projected.x - candidate.x, projected.y - candidate.y);
    if (d <= endpointSnapCm && (best === null || d < best.d)) {
      best = { d, p: projected };
    }
  }
  return best ? best.p : null;
}

/**
 * Snap a candidate wall endpoint (in cm) to the nearest existing wall endpoint
 * or segment within `endpointSnapCm`. A mid-segment hit is later converted to
 * a real T junction by splitWallsAtJunctions in the project reducer.
 *
 * Axis locking (ortho) is intentionally NOT done here — that lives in
 * `applyAxisLock` and is opt-in via the Shift key. Bundling it here made
 * every drag snap to 0/90/180/270°, defeating free-angle drawing.
 */
export function snapEndpoint(candidate: Point, walls: Wall[], endpointSnapCm: number): Point {
  const target = findEndpointSnapTarget(candidate, walls, endpointSnapCm);
  return target ?? candidate;
}

/**
 * Screen-pixel snap radius for endpoint targeting. Converting to cm at
 * the call site (via 1 / scale) keeps the "hot zone" the same visual
 * size regardless of zoom — otherwise it's unreachable when zoomed out.
 */
export const ENDPOINT_SNAP_PIXELS = 16;

/**
 * Format an internal-cm length for display. Rounding is display-only —
 * storage and math keep the raw cm number so accumulated edits don't
 * drift by fractions of a centimeter.
 */
export function formatLength(cm: number, units: "cm" | "m"): string {
  if (units === "m") {
    const meters = cm / 100;
    return `${meters.toFixed(2)} מ'`;
  }
  return `${Math.round(cm)} ס"מ`;
}

/**
 * The wall thickness implied by dragging the far face out to `pointer`.
 *
 * Measured along the wall's OUTWARD normal only, so a pointer dragged past the
 * wall and out the inner side clamps to the minimum instead of coming back as a
 * positive thickness on the wrong side — the far face can never flip through
 * the wall. Snapped to `stepCm` because a mouse cannot hold a tenth of a
 * centimetre; the numeric field stays finer for when that matters.
 */
export function thicknessFromPointer(
  centerline: [Point, Point],
  outwardSign: 1 | -1,
  pointer: Point,
  bounds: { minCm: number; maxCm: number; stepCm: number }
): number {
  const [a, b] = centerline;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return bounds.minCm;

  // Same (dy, -dx) frame as wallNormal, scaled by the resolved outward sign.
  const nx = ((b.y - a.y) / length) * outwardSign;
  const ny = ((a.x - b.x) / length) * outwardSign;
  const outward = (pointer.x - a.x) * nx + (pointer.y - a.y) * ny;

  const snapped = Math.round(outward / bounds.stepCm) * bounds.stepCm;
  const clamped = Math.min(bounds.maxCm, Math.max(bounds.minCm, snapped));
  // Snapping can leave 1e-15 tails that would render as "20.000000000000004".
  return Math.round(clamped * 100) / 100;
}

/**
 * Which perpendicular side of each wall its length label belongs on: away from
 * the middle of the ring that wall is part of, in the (dy,-dx) frame.
 *
 * Worked out per connected ring rather than per plan, so a room drawn inside
 * another room gets its labels in the gap between the two rather than all of
 * them pushed out past the outer wall.
 *
 * Deliberately NOT `outwardSign`. That answers a different question — which of
 * the two faces is the far one — and on a wall the engine paired it points at
 * the partner contour, which is towards the middle of the outer ring. Riding
 * the label on it is what put the side walls' lengths inside the room.
 */
export function labelSideByWallId(walls: Wall[]): Map<string, 1 | -1> {
  const componentOf = connectedComponents(walls);
  const centres = new Map<number, { x: number; y: number; n: number }>();

  for (const wall of walls) {
    const key = componentOf.get(wall.id)!;
    const acc = centres.get(key) ?? { x: 0, y: 0, n: 0 };
    for (const p of wall.innerLine) {
      acc.x += p.x;
      acc.y += p.y;
      acc.n += 1;
    }
    centres.set(key, acc);
  }

  const sides = new Map<string, 1 | -1>();
  for (const wall of walls) {
    const acc = centres.get(componentOf.get(wall.id)!)!;
    const [a, b] = wall.innerLine;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0 || acc.n === 0) {
      sides.set(wall.id, 1);
      continue;
    }

    const nx = (b.y - a.y) / length;
    const ny = (a.x - b.x) / length;
    const toCentre = {
      x: acc.x / acc.n - (a.x + b.x) / 2,
      y: acc.y / acc.n - (a.y + b.y) / 2,
    };
    sides.set(wall.id, toCentre.x * nx + toCentre.y * ny > 0 ? -1 : 1);
  }
  return sides;
}

/** Groups walls that touch end to end, so each traced ring is its own group. */
function connectedComponents(walls: Wall[]): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const wall of walls) parent.set(wall.id, wall.id);

  const touches = (a: Wall, b: Wall) =>
    a.innerLine.some((p) =>
      b.innerLine.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= ENDPOINT_TOUCH_CM)
    );

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      if (!touches(walls[i]!, walls[j]!)) continue;
      const ra = find(walls[i]!.id);
      const rb = find(walls[j]!.id);
      if (ra !== rb) parent.set(ra, rb);
    }
  }

  const index = new Map<string, number>();
  const result = new Map<string, number>();
  for (const wall of walls) {
    const root = find(wall.id);
    if (!index.has(root)) index.set(root, index.size);
    result.set(wall.id, index.get(root)!);
  }
  return result;
}

/** Same tolerance the engine snaps wall endpoints together with. */
const ENDPOINT_TOUCH_CM = 2;

/** Folds an angle into (-180, 180]. */
function normaliseDeg(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Where a wall's length label sits, and which way up it reads. */
export interface WallLabelPlacement {
  x: number;
  y: number;
  rotationDeg: number;
}

/**
 * Places a wall's length label `offsetCm` clear of the wall, on `side`.
 *
 * The rotation is flipped for walls pointing into the left half so the text is
 * never read upside down — but ONLY the rotation. Flipping used to negate the
 * offset as well, which put the label on the far side of the wall: on a room,
 * that is inside it. The anchor is the text's centre, so turning it 180 degrees
 * about that point leaves it exactly where it was.
 */
export function wallLabelPlacement(
  wall: Wall,
  side: 1 | -1,
  offsetCm: number
): WallLabelPlacement | null {
  const [a, b] = wall.innerLine;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;

  const push = offsetCm * side;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const upsideDown = angleDeg > 90 || angleDeg < -90;

  return {
    x: (a.x + b.x) / 2 + (dy / length) * push,
    y: (a.y + b.y) / 2 + (-dx / length) * push,
    // Normalised, so a wall drawn right-to-left reports 0 rather than 360 and
    // two walls on the same line compare equal.
    rotationDeg: normaliseDeg(upsideDown ? angleDeg + 180 : angleDeg),
  };
}

/**
 * How deep a placement's band is drawn, in cm — the panel's own thickness.
 *
 * Matches AccessoryRules.outerCornerProtrusionCm, and that is not a
 * coincidence: at an outer corner the lapping panel has to run the full
 * thickness of the panel it laps to reach its outer surface. Draw the band
 * thinner than that reach and the panel juts out past the corner; draw it
 * thicker and an uncovered notch opens up. They have to agree.
 */
export const PLACEMENT_BAND_DEPTH_CM = 10;

/**
 * Creates canvas-only copies with the external-corner joint from the reference.
 * Exactly one panel owns the corner square. We use the steeper member of the
 * pair as the deterministic owner (vertical on this orthogonal reference); it
 * stops `clearanceCm` short of the outside edge. The other panel stops at the
 * side of the square, so they meet along an edge without sharing any area.
 * Stored placement widths and all engine/BOM calculations remain unchanged.
 */
export function placementsWithOuterCornerJoint(
  placements: Placement[],
  walls: Wall[],
  layout: ProjectLayout | undefined,
  protrusionCm: number = PLACEMENT_BAND_DEPTH_CM,
  clearanceCm: number = 2
): Placement[] {
  if (!layout) return placements;

  const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const convexEnds = new Map<string, { atA: boolean; atB: boolean }>();
  for (const corner of layout.corners) {
    if (corner.side !== "outer") continue;
    for (const edgeId of [corner.edgeAId, corner.edgeBId]) {
      const edge = edgeById.get(edgeId);
      if (!edge) continue;
      const current = convexEnds.get(edgeId) ?? { atA: false, atB: false };
      if (edge.nodeA === corner.nodeId) current.atA = true;
      if (edge.nodeB === corner.nodeId) current.atB = true;
      convexEnds.set(edgeId, current);
    }
  }

  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const runs = new Map<string, Placement[]>();
  for (const placement of placements) {
    if (placement.faceIsInterior || placement.kind === "corner-panel") continue;
    const key = `${placement.edgeId}|${placement.side}`;
    const run = runs.get(key);
    if (run) run.push(placement);
    else runs.set(key, [placement]);
  }

  const extensionById = new Map<string, { before: number; after: number }>();
  for (const run of runs.values()) {
    const first = run.reduce((best, p) => (p.offsetAlongEdge < best.offsetAlongEdge ? p : best));
    const last = run.reduce((best, p) =>
      p.offsetAlongEdge + p.width > best.offsetAlongEdge + best.width ? p : best
    );
    const ends = convexEnds.get(first.edgeId);
    const wall = wallById.get(first.wallId);
    if (!ends || !wall) continue;

    const d = wallDirection(wall);
    const ownsCorner = Math.abs(d.y) > Math.abs(d.x);
    const panelDepth = Math.max(0, protrusionCm);
    const extension = ownsCorner
      ? Math.max(0, panelDepth - Math.max(0, clearanceCm))
      : 0;

    if (ends.atA) {
      const current = extensionById.get(first.id) ?? { before: 0, after: 0 };
      extensionById.set(first.id, { ...current, before: extension });
    }
    if (ends.atB) {
      const current = extensionById.get(last.id) ?? { before: 0, after: 0 };
      extensionById.set(last.id, { ...current, after: extension });
    }
  }

  if (extensionById.size === 0) return placements;
  return placements.map((placement) => {
    const extension = extensionById.get(placement.id);
    if (!extension) return placement;
    const requestedShrink =
      Math.max(0, -extension.before) + Math.max(0, -extension.after);
    const availableShrink = Math.max(0, placement.width - 0.01);
    const shrinkFactor =
      requestedShrink > availableShrink && requestedShrink > 0
        ? availableShrink / requestedShrink
        : 1;
    const before = extension.before < 0 ? extension.before * shrinkFactor : extension.before;
    const after = extension.after < 0 ? extension.after * shrinkFactor : extension.after;
    return {
      ...placement,
      offsetAlongEdge: placement.offsetAlongEdge - before,
      width: placement.width + before + after,
    };
  });
}

/** The four corners of the band a placement paints, in world coordinates. */
export function placementBandCorners(
  placement: Placement,
  wall: Wall,
  frame: { outwardSign: 1 | -1; faceBOffsetCm: number },
  depthCm: number = PLACEMENT_BAND_DEPTH_CM
): [Point, Point, Point, Point] {
  // Face B sits one wall thickness out along the resolved outward direction;
  // face A sits on the centerline. Both bands then extend away from the wall
  // body, so neither ever covers the concrete between them.
  const sideSign: 1 | -1 =
    placement.side === "faceB" ? frame.outwardSign : (-frame.outwardSign as 1 | -1);
  const baseOffset = placement.side === "faceB" ? frame.faceBOffsetCm * frame.outwardSign : 0;

  const n = wallNormal(wall);
  const corners = placementCorners(
    wall,
    placement.offsetAlongEdge,
    placement.width,
    sideSign,
    depthCm
  );

  return corners.map((c) => ({
    x: c.x + n.x * baseOffset,
    y: c.y + n.y * baseOffset,
  })) as [Point, Point, Point, Point];
}

/** Axis-aligned bounds of that band — what two panels overlap in is measured on these. */
export interface PlacementBand {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Axis-aligned bounds of four already-positioned band corners. */
export function bandFromCorners(corners: readonly Point[]): PlacementBand {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

/**
 * The band as bounds rather than corners.
 *
 * Exists so the corner joint can be MEASURED. The overlap the user sees is not
 * `clearLength` or `offsetAlongEdge` — it is where these rectangles fall, which
 * takes five separate values plus the band depth to work out. That arithmetic
 * lived inside the canvas component and so was never covered by a test, and the
 * outer-corner overlap was got wrong four times in a row underneath green tests
 * that only ever checked the run numbers.
 */
export function placementBand(
  placement: Placement,
  wall: Wall,
  frame: { outwardSign: 1 | -1; faceBOffsetCm: number },
  depthCm: number = PLACEMENT_BAND_DEPTH_CM
): PlacementBand {
  const corners = placementBandCorners(placement, wall, frame, depthCm);
  return bandFromCorners(corners);
}

/** Where two bands overlap, in cm per axis. Zero or negative means they do not. */
export function bandOverlap(a: PlacementBand, b: PlacementBand): { x: number; y: number } {
  return {
    x: Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0),
    y: Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0),
  };
}

/** One place where two panels on different walls physically overlap. */
export interface BandOverlapRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Every spot where a panel on one wall overlaps a panel on another.
 *
 * On a correct plan these are exactly the outer corners, where the joint is
 * built by design. At the zoom a whole plan is drawn at the overlap is only a
 * few pixels, so without marking it the joint is easy to read as two panels
 * merely touching.
 *
 * Anywhere else one appears is a fault worth seeing, which is the other reason
 * this is measured rather than drawn from the rule.
 */
export function panelOverlapRects(
  bands: Array<{ edgeId: string; band: PlacementBand }>
): BandOverlapRect[] {
  const rects: BandOverlapRect[] = [];

  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i]!;
      const b = bands[j]!;
      // Panels along one wall butt against each other by design.
      if (a.edgeId === b.edgeId) continue;

      const overlap = bandOverlap(a.band, b.band);
      if (overlap.x <= 0.01 || overlap.y <= 0.01) continue;

      rects.push({
        x0: Math.max(a.band.x0, b.band.x0),
        y0: Math.max(a.band.y0, b.band.y0),
        x1: Math.min(a.band.x1, b.band.x1),
        y1: Math.min(a.band.y1, b.band.y1),
      });
    }
  }
  return rects;
}
