import { perpendicularDistance } from "@rastoplan/core";
import type { OutwardSign, Point, ProjectLayout, ResolvedWall, Wall } from "@rastoplan/core";

/**
 * Everything the canvas needs to draw one wall: where its centerline runs, how
 * thick it is, and which way is out.
 *
 * `outwardSign` is the fix for panels landing on the wrong side. It used to be
 * hard-coded to the wall's own A→B drag direction, so on a room whose walls
 * were not all drawn the same way round, some outer bands rendered inside the
 * room on top of the inner ones. It now comes from the engine's resolution of
 * the wall loop.
 */
export interface ResolvedWallFrame {
  centerline: [Point, Point];
  thickness: number;
  /** false while a newly drawn single line is still waiting for user input */
  thicknessIsSet: boolean;
  /** where face B's panels sit, perpendicular to the centerline */
  faceBOffsetCm: number;
  outwardSign: OutwardSign;
  faceAIsInterior: boolean;
  faceBIsInterior: boolean;
  /**
   * True only once a compute has decided this wall was nothing but the far face
   * of another. It dims and dashes the wall, so it must never be set from the
   * live preview: a plan mid-edit would grey out half of what the user is
   * drawing on a guess the engine has not actually committed to.
   */
  isConsumed: boolean;
  /**
   * This wall is the second half of a preview pair, so the OTHER half draws the
   * shared thickness dimension. Both describe one gap; two dimension lines on
   * it would just be the same measurement printed twice.
   */
  deferDimension: boolean;
  /**
   * Face B is a wall the user drew, not a line derived from the thickness.
   * That face is therefore already on screen as its own (consumed) wall, and
   * drawing a derived one for it would put two lines on the same face.
   */
  faceBIsDrawn: boolean;
}

export type ThicknessDimensionMode = "hidden" | "static" | "interactive";

/**
 * Every physical wall keeps one readable thickness dimension on the canvas.
 * A consumed/deferred partner must not duplicate it; editing controls are
 * enabled only for the primary selected wall.
 */
export function thicknessDimensionMode(
  frame: Pick<
    ResolvedWallFrame,
    "isConsumed" | "deferDimension" | "faceBIsDrawn" | "thicknessIsSet"
  >,
  isPrimary: boolean,
  wallEditingEnabled: boolean
): ThicknessDimensionMode {
  // Every source wall exposes its thickness. A consumed/deferred contour is
  // hidden only because its partner already draws that exact same dimension.
  if (!frame.thicknessIsSet || frame.isConsumed || frame.deferDimension) return "hidden";
  return isPrimary && wallEditingEnabled ? "interactive" : "static";
}

/**
 * Stable identity for one physical wall's thickness dimension.
 *
 * Paired contours share a key by their two wall ids. Unpaired walls keep their
 * own id even when they happen to be collinear and have the same thickness;
 * grouping those geometrically hid legitimate dimensions the user asked to
 * see and edit independently.
 */
export function thicknessDimensionGroupKey(
  wall: Wall,
  _frame: Pick<ResolvedWallFrame, "faceBOffsetCm" | "outwardSign">
): string {
  const pair = wall.pairedWallId
    ? [wall.id, wall.pairedWallId].sort().join("|")
    : wall.id;
  return `${wall.pourId}|${pair}`;
}

/**
 * Thickness the user should see right now.
 *
 * A computed layout wins when available. Before compute, a preview-paired wall
 * reads the actual distance to its drawn partner without mutating either wall's
 * stored value. A single-contour wall falls back to its declared thickness.
 */
export function displayedWallThickness(
  wall: Wall,
  layout: ProjectLayout | undefined,
  walls: Wall[]
): number {
  const resolved = layout?.resolvedWalls.find(
    (candidate) =>
      candidate.sourceWallId === wall.id || candidate.consumedWallIds.includes(wall.id)
  );
  if (resolved) return resolved.thickness;

  const partner = wall.pairedWallId
    ? walls.find((candidate) => candidate.id === wall.pairedWallId)
    : undefined;
  if (!partner) return wall.thickness;

  const partnerMidpoint = {
    x: (partner.innerLine[0].x + partner.innerLine[1].x) / 2,
    y: (partner.innerLine[0].y + partner.innerLine[1].y) / 2,
  };
  const measured = perpendicularDistance(partnerMidpoint, wall.innerLine);
  return Number.isFinite(measured) && measured > 0 ? measured : wall.thickness;
}

/**
 * The frame for a wall, from the last computed layout when there is one.
 *
 * Falls back to the pre-contour-layer behaviour (drawn line, typed thickness,
 * outward = +1) for projects that haven't been computed yet, so a freshly
 * loaded or freshly drawn plan renders exactly as it did before.
 */
export function resolvedWallFrame(
  wall: Wall,
  layout: ProjectLayout | undefined,
  walls: Wall[] = []
): ResolvedWallFrame {
  const resolved = layout?.resolvedWalls.find((w) => w.id === wall.id);
  if (resolved) return frameOf(resolved);

  // Paired but not yet computed. The reducer measures the gap from the drawing
  // on every edit, so the thickness is already known here — waiting for a
  // compute to draw it would hide a number the engine has already worked out.
  const partner = wall.pairedWallId ? walls.find((w) => w.id === wall.pairedWallId) : undefined;
  if (partner) return pairedFrame(wall, partner);

  if (layout && isConsumed(wall.id, layout)) {
    return {
      centerline: wall.innerLine,
      thickness: wall.thickness,
      thicknessIsSet: wall.thicknessSet !== false,
      faceBOffsetCm: wall.thickness,
      outwardSign: 1,
      faceAIsInterior: false,
      faceBIsInterior: false,
      isConsumed: true,
      faceBIsDrawn: false,
      deferDimension: false,
    };
  }

  return {
    centerline: wall.innerLine,
    thickness: wall.thickness,
    thicknessIsSet: wall.thicknessSet !== false,
    faceBOffsetCm: wall.thickness,
    outwardSign: fallbackOutwardSign(wall, walls),
    faceAIsInterior: true,
    faceBIsInterior: false,
    isConsumed: false,
    faceBIsDrawn: false,
    deferDimension: false,
  };
}

/**
 * Which way is "out" before the engine has resolved it.
 *
 * Away from the middle of everything drawn, which is right for any plan that
 * wraps its walls around a space — every plan the app is for. It replaces a
 * hard-coded +1, whose direction depended purely on which way round the user
 * happened to trace: on a rectangle that put the length labels of two of the
 * four walls INSIDE the room, and the derived far-face line with them.
 *
 * Only a fallback. Once a layout exists the engine's own outward sign, derived
 * from the wall loop rather than guessed from a centroid, always wins.
 */
function fallbackOutwardSign(wall: Wall, walls: Wall[]): OutwardSign {
  const points = walls.flatMap((w) => w.innerLine);
  if (points.length === 0) return 1;

  const centre = points.reduce(
    (sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }),
    { x: 0, y: 0 }
  );

  const [a, b] = wall.innerLine;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return 1;

  const nx = (b.y - a.y) / length;
  const ny = (a.x - b.x) / length;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const toCentre = { x: centre.x - mid.x, y: centre.y - mid.y };

  return toCentre.x * nx + toCentre.y * ny > 0 ? -1 : 1;
}

export function isConsumed(wallId: string, layout: ProjectLayout | undefined): boolean {
  return !!layout?.resolvedWalls.some((w) => w.consumedWallIds.includes(wallId));
}

/**
 * The frame for one half of a drawn pair, before the engine has run.
 *
 * Neither half is marked consumed. Nothing here has been computed yet, and
 * dimming one of the two lines the user just drew — on a pairing the engine may
 * still revise — reads as the app quietly deleting their work. The dimension is
 * still drawn once rather than twice: the lower id carries it, which is
 * arbitrary but stable, so it cannot flicker between the two while editing.
 */
function pairedFrame(wall: Wall, partner: Wall): ResolvedWallFrame {
  const [a, b] = wall.innerLine;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const normal = { x: (b.y - a.y) / length, y: (a.x - b.x) / length };
  const mid = {
    x: (partner.innerLine[0].x + partner.innerLine[1].x) / 2 - a.x,
    y: (partner.innerLine[0].y + partner.innerLine[1].y) / 2 - a.y,
  };
  const liveThickness = displayedWallThickness(wall, undefined, [wall, partner]);

  return {
    centerline: wall.innerLine,
    thickness: liveThickness,
    thicknessIsSet: true,
    faceBOffsetCm: liveThickness,
    // Toward the partner, so the far face is the line the user actually drew.
    outwardSign: mid.x * normal.x + mid.y * normal.y >= 0 ? 1 : -1,
    faceAIsInterior: true,
    faceBIsInterior: false,
    isConsumed: false,
    faceBIsDrawn: true,
    deferDimension: wall.id > partner.id,
  };
}

function frameOf(resolved: ResolvedWall): ResolvedWallFrame {
  return {
    centerline: resolved.centerline,
    thickness: resolved.thickness,
    thicknessIsSet: true,
    faceBOffsetCm: resolved.faceBOffsetCm,
    outwardSign: resolved.outwardSign,
    faceAIsInterior: resolved.faces[0].isInterior,
    faceBIsInterior: resolved.faces[1].isInterior,
    isConsumed: false,
    faceBIsDrawn: !!resolved.faces[1].sourceWallId,
    deferDimension: false,
  };
}
