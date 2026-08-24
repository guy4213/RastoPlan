import type { Diagnostic, Point, Wall } from "../types.js";
import { lineIntersection, perpendicularDistance, unitNormal } from "../geometry/polygon.js";
import { SNAP_TOLERANCE_CM } from "../geometry/buildGraph.js";
import { distance } from "../geometry/vector.js";
import { GEOMETRY_RESOLUTION_FLOOR_CM } from "./constants.js";

export interface RetargetResult {
  /** the partner, moved — or returned untouched when the move was refused */
  wall: Wall;
  /** set only when nothing moved, explaining why */
  diagnostic?: Diagnostic;
}

/**
 * Moves the far contour of a two-contour wall so the gap between the two drawn
 * lines becomes `newThicknessCm`.
 *
 * The wall the user is editing (`anchor`) does not move: it is the face they
 * have their hands on, and moving it instead would slide the room under them.
 * The partner translates perpendicular to the anchor and nothing else, so its
 * length and its position along the wall's axis are both preserved — only the
 * separation changes. The direction comes from where the partner already sits,
 * so the inner face stays the inner face.
 *
 * Pure: no clamping to the project, no side effects. The caller decides what to
 * do with a refusal.
 */
export function retargetPairedWall(
  anchor: Wall,
  partner: Wall,
  newThicknessCm: number
): RetargetResult {
  const refuse = (code: string, message: string): RetargetResult => ({
    wall: partner,
    diagnostic: {
      code,
      severity: "error",
      message,
      wallIds: [anchor.id, partner.id],
      nodeIds: [],
    },
  });

  if (!Number.isFinite(newThicknessCm) || newThicknessCm <= GEOMETRY_RESOLUTION_FLOOR_CM) {
    return refuse(
      "thickness-below-geometry-resolution",
      `עובי של ${newThicknessCm} ס"מ קטן מדי — המנוע לא יוכל להבחין בין שני צדי הקיר. המינימום הוא ${GEOMETRY_RESOLUTION_FLOOR_CM} ס"מ`
    );
  }

  const normal = unitNormal(anchor.innerLine[0], anchor.innerLine[1]);
  if (!normal) {
    return refuse(
      "degenerate-anchor-wall",
      `לקיר ${anchor.id} אין אורך — לא ניתן לגזור ממנו כיוון להזזת הפאה הנגדית`
    );
  }

  const partnerMid: Point = {
    x: (partner.innerLine[0].x + partner.innerLine[1].x) / 2,
    y: (partner.innerLine[0].y + partner.innerLine[1].y) / 2,
  };
  const toPartner = {
    x: partnerMid.x - anchor.innerLine[0].x,
    y: partnerMid.y - anchor.innerLine[0].y,
  };
  // Which side the partner is on today. Preserving it is what stops a thickness
  // edit from flipping the far face through the wall to the other side.
  const side = toPartner.x * normal.x + toPartner.y * normal.y >= 0 ? 1 : -1;

  const currentGap = perpendicularDistance(partnerMid, anchor.innerLine);
  const shift = (newThicknessCm - currentGap) * side;
  const delta = { x: normal.x * shift, y: normal.y * shift };

  return {
    wall: {
      ...partner,
      innerLine: [
        { x: partner.innerLine[0].x + delta.x, y: partner.innerLine[0].y + delta.y },
        { x: partner.innerLine[1].x + delta.x, y: partner.innerLine[1].y + delta.y },
      ],
      thickness: newThicknessCm,
    },
  };
}

export interface RetargetThicknessResult {
  walls: Wall[];
  diagnostics: Diagnostic[];
  /** false when nothing was changed — the caller should leave the field alone */
  applied: boolean;
}

/**
 * Changes one wall's thickness on a plan traced as two contours, keeping the
 * far contour closed.
 *
 * Offsetting a segment of a closed ring is not enough on its own: translating
 * it perpendicular by delta leaves a delta-sized hole at each of its two
 * corners, far past the tolerance buildGraph snaps endpoints with, so the ring
 * comes apart and the next compute reads back the OLD thickness. The corners
 * are therefore re-mitred — each neighbour keeps its direction and its far end,
 * and its shared end moves to wherever it now meets the offset line. That is
 * also why moving all the segments together does not help: translation alone
 * can never close a corner, because the two sides move in different directions.
 *
 * Only the partner and its immediate neighbours move. The wall the user is
 * editing does not, and neither does any neighbour's own thickness: a mitred
 * neighbour slides along its own axis, which leaves its distance from its own
 * partner untouched.
 */
export function retargetWallThickness(
  walls: Wall[],
  anchorId: string,
  newThicknessCm: number
): RetargetThicknessResult {
  const unchanged = (diagnostics: Diagnostic[] = []): RetargetThicknessResult => ({
    walls,
    diagnostics,
    applied: false,
  });

  const anchor = walls.find((w) => w.id === anchorId);
  if (!anchor) return unchanged();

  // No partner: the far face is derived from the thickness, so there is no
  // geometry to keep in step and the plain field edit is the whole change.
  if (!anchor.pairedWallId) {
    if (newThicknessCm <= GEOMETRY_RESOLUTION_FLOOR_CM) return unchanged();
    return {
      walls: walls.map((w) => (w.id === anchorId ? { ...w, thickness: newThicknessCm } : w)),
      diagnostics: [],
      applied: true,
    };
  }

  const partner = walls.find((w) => w.id === anchor.pairedWallId);
  if (!partner) {
    return unchanged([
      {
        code: "paired-wall-missing",
        severity: "error",
        message: `בן הזוג של ${anchor.id} כבר לא קיים — יש לחשב מחדש לפני שינוי העובי`,
        wallIds: [anchor.id],
        nodeIds: [],
      },
    ]);
  }

  const moved = retargetPairedWall(anchor, partner, newThicknessCm);
  if (moved.diagnostic) return unchanged([moved.diagnostic]);

  const diagnostics: Diagnostic[] = [];
  const mitred = walls.map((wall) => {
    if (wall.id === anchor.id) return { ...wall, thickness: newThicknessCm };
    if (wall.id === partner.id) return moved.wall;
    return mitreToOffsetLine(wall, partner, moved.wall, diagnostics);
  });

  return { walls: mitred, diagnostics, applied: true };
}

/**
 * Pulls `wall`'s shared corner onto the line `partner` has moved to, if the two
 * met at all. Its direction and its far end are preserved, so it slides along
 * its own axis and nothing about its own thickness changes.
 */
function mitreToOffsetLine(
  wall: Wall,
  partnerBefore: Wall,
  partnerAfter: Wall,
  diagnostics: Diagnostic[]
): Wall {
  const meetsAt = [0, 1].find((end) =>
    partnerBefore.innerLine.some(
      (corner) => distance(wall.innerLine[end as 0 | 1], corner) <= SNAP_TOLERANCE_CM
    )
  );
  if (meetsAt === undefined) return wall;

  const corner = lineIntersection(wall.innerLine, partnerAfter.innerLine);
  if (!corner) {
    diagnostics.push({
      code: "corner-not-remitrable",
      severity: "warning",
      message: `${wall.id} מקביל לקיר שזז, ולכן לא ניתן לסגור איתו את הפינה — יש לתקן את הקונטור ידנית`,
      wallIds: [wall.id, partnerAfter.id],
      nodeIds: [],
    });
    return wall;
  }

  const innerLine: [Point, Point] = [{ ...wall.innerLine[0] }, { ...wall.innerLine[1] }];
  innerLine[meetsAt as 0 | 1] = corner;
  return { ...wall, innerLine };
}
