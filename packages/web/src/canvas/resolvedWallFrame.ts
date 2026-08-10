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
  /** where face B's panels sit, perpendicular to the centerline */
  faceBOffsetCm: number;
  outwardSign: OutwardSign;
  faceAIsInterior: boolean;
  faceBIsInterior: boolean;
  /** true when this wall was only the far face of another and carries no formwork of its own */
  isConsumed: boolean;
}

/**
 * The frame for a wall, from the last computed layout when there is one.
 *
 * Falls back to the pre-contour-layer behaviour (drawn line, typed thickness,
 * outward = +1) for projects that haven't been computed yet, so a freshly
 * loaded or freshly drawn plan renders exactly as it did before.
 */
export function resolvedWallFrame(wall: Wall, layout: ProjectLayout | undefined): ResolvedWallFrame {
  const resolved = layout?.resolvedWalls.find((w) => w.id === wall.id);
  if (resolved) return frameOf(resolved);

  if (layout && isConsumed(wall.id, layout)) {
    return {
      centerline: wall.innerLine,
      thickness: wall.thickness,
      faceBOffsetCm: wall.thickness,
      outwardSign: 1,
      faceAIsInterior: false,
      faceBIsInterior: false,
      isConsumed: true,
    };
  }

  return {
    centerline: wall.innerLine,
    thickness: wall.thickness,
    faceBOffsetCm: wall.thickness,
    outwardSign: 1,
    faceAIsInterior: true,
    faceBIsInterior: false,
    isConsumed: false,
  };
}

export function isConsumed(wallId: string, layout: ProjectLayout | undefined): boolean {
  return !!layout?.resolvedWalls.some((w) => w.consumedWallIds.includes(wallId));
}

function frameOf(resolved: ResolvedWall): ResolvedWallFrame {
  return {
    centerline: resolved.centerline,
    thickness: resolved.thickness,
    faceBOffsetCm: resolved.faceBOffsetCm,
    outwardSign: resolved.outwardSign,
    faceAIsInterior: resolved.faces[0].isInterior,
    faceBIsInterior: resolved.faces[1].isInterior,
    isConsumed: false,
  };
}
