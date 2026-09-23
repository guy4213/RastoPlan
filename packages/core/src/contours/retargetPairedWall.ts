import type { Diagnostic, Point, ResolvedWall, Wall } from "../types.js";
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
 * Which of a paired wall's two drawn contours is the outer one, per the last
 * computed layout — the face that does NOT border a room. `null` when it
 * cannot be determined: no layout yet (nothing computed since these two walls
 * were drawn/paired), or a genuine partition where both faces border a room
 * and neither is "outer" at all. The caller falls back to its own default in
 * either case.
 *
 * Reads `resolvedWalls` rather than recomputing geometry: the same full
 * resolution already runs on every "חשב", and re-running it on every
 * keystroke or drag frame of a thickness edit — the two places this feeds —
 * would be the wrong cost to pay for a lookup this cheap. A topology change
 * that flips which face is outer only happens on a geometry edit, which
 * already drops the stale layout (see withLayoutInvalidated in the web app),
 * so a layout that still exists is never stale in the way that would matter
 * here.
 */
export function outerContourWallId(
  resolvedWalls: readonly ResolvedWall[] | undefined,
  wallIdA: string,
  wallIdB: string
): string | null {
  if (!resolvedWalls) return null;
  const resolvedWall = resolvedWalls.find(
    (rw) =>
      (rw.sourceWallId === wallIdA || rw.consumedWallIds.includes(wallIdA)) &&
      (rw.sourceWallId === wallIdB || rw.consumedWallIds.includes(wallIdB))
  );
  if (!resolvedWall) return null;

  // A drawn face bordering no room is the exterior. Exactly one such face
  // means an ordinary exterior wall; zero means a partition (both faces
  // border a room); two should not occur for a valid two-contour pair, but is
  // treated the same as "cannot tell" rather than guessed at.
  const exteriorFaces = resolvedWall.faces.filter(
    (face) => face.sourceWallId !== undefined && !face.isInterior
  );
  if (exteriorFaces.length !== 1) return null;
  return exteriorFaces[0]!.sourceWallId ?? null;
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
 * Which of the pair stays put: the OUTER contour, when `resolvedWalls` says
 * which one that is (customer decision, 13/9/2026 — the drawn outer dimensions
 * are what's on the engineering plan and must never move when tuning
 * thickness). Otherwise — no layout yet, a partition with no outer face, or a
 * neighbour that cannot be re-mitred to the far side of an already-moved
 * corner from this same edit — the wall the user is actively editing stays
 * put instead, exactly as before this rule existed. Either way, only the
 * wall that actually moves and its immediate neighbours change; the anchor's
 * own thickness field updates regardless of which one physically moved.
 */
export function retargetWallThickness(
  walls: Wall[],
  anchorId: string,
  newThicknessCm: number,
  /** the last computed layout's resolved walls, so the outer contour can be identified; omit to always keep the edited wall stationary */
  resolvedWalls?: readonly ResolvedWall[]
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

  const applyMove = (stationary: Wall, moving: Wall): RetargetThicknessResult | null => {
    const moved = retargetPairedWall(stationary, moving, newThicknessCm);
    if (moved.diagnostic) return unchanged([moved.diagnostic]);

    const diagnostics: Diagnostic[] = [];
    const mitred = walls.map((wall) => {
      if (wall.id === stationary.id) return { ...wall, thickness: newThicknessCm };
      if (wall.id === moving.id) return moved.wall;
      return mitreToOffsetLine(wall, moving, moved.wall, diagnostics);
    });

    return { walls: mitred, diagnostics, applied: true };
  };

  const outerId = outerContourWallId(resolvedWalls, anchor.id, partner.id);
  if (outerId === partner.id) {
    // The outer contour is known and it is not the wall being edited: move
    // the edited (inner) wall instead, keeping the outer one — and everything
    // that only touches it — exactly where it is.
    //
    // A drawn wall that a T junction split only PART of into a paired segment
    // (its sibling segment stayed single-contour, un-paired with the outer
    // line at all — see resolveWalls) can make this move tear that T corner
    // open: the edited segment slides away from its sibling, which nothing
    // here re-mitres because the sibling was never told to follow. That is a
    // real defect, not a cosmetic warning, so it is not accepted — the whole
    // move falls back to the plain default below instead, exactly as if the
    // outer contour could not be identified at all.
    const outerAnchored = applyMove(partner, anchor);
    if (outerAnchored && !outerAnchored.diagnostics.some((d) => d.code === "corner-not-remitrable")) {
      return outerAnchored;
    }
  }

  // Default: the wall the user is actively editing stays put. Reached when
  // the outer contour is unknown (no layout yet, or a partition with no
  // outer face at all) and as the safe fallback above.
  return applyMove(anchor, partner) ?? unchanged();
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
