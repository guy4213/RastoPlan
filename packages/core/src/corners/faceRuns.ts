import type {
  AccessoryRules,
  CornerAtNode,
  Edge,
  Node,
  PlacementSide,
  ResolvedWall,
  Wall,
} from "../types.js";
import { otherWallThicknessAt } from "../geometry/neighborThickness.js";

/**
 * The tileable stretch of one face, in the wall's own along-axis frame: 0 is
 * the drawn line's start, and the axis runs toward its end.
 *
 * Both faces share that frame rather than each starting at its own zero,
 * because the outer face of a wall does not begin level with the inner one —
 * it runs on past the corner by the neighbouring wall's thickness. Expressing
 * that as a negative start offset is what lets the canvas place both faces off
 * the same drawn line.
 */
export interface FaceRun {
  startOffset: number;
  clearLength: number;
  /** what each end gives up: a corner panel's leg, or a corner overlap strip */
  consumedAtA: number;
  consumedAtB: number;
  /** how far the face reaches past the drawn line at each end */
  extensionAtA: number;
  extensionAtB: number;
  /**
   * The outer-corner joint at each end: how far this face runs past its
   * neighbour's outer face line so the two panels overlap there. Zero at a
   * concave corner and on every room-facing face. Kept apart from the extension
   * so the wrap stays pure geometry and the joint stays a rule.
   */
  lapAtA: number;
  lapAtB: number;
}

export interface FaceRunInput {
  edge: Edge;
  resolvedWall: ResolvedWall;
  face: PlacementSide;
  /** whole cm; the drawn line's length */
  geometricLength: number;
  cornersAtA: CornerAtNode[];
  cornersAtB: CornerAtNode[];
  /** selected physical corner panel width by CornerAtNode.id */
  cornerPanelWidthById: ReadonlyMap<string, number>;
  rules: AccessoryRules;
  edges: Edge[];
  nodeById: Map<string, Node>;
  wallById: Map<string, Wall>;
}

/**
 * Works out where a face's straight run begins and how long it is.
 *
 * The inner face is bounded by the drawn line. The outer face is longer at a
 * convex corner (it wraps around the neighbour) and shorter at a concave one,
 * by exactly the neighbour's thickness — which is why the outer ring of a room
 * carries more panels than the inner ring, as it does on the customer's plans.
 */
export function faceRunFor(input: FaceRunInput): FaceRun {
  const {
    edge,
    resolvedWall,
    face,
    geometricLength,
    cornersAtA,
    cornersAtB,
    cornerPanelWidthById,
    rules,
    edges,
    wallById,
  } = input;

  const faceSpec = resolvedWall.faces.find((f) => f.id === face);
  const bordersRoom = faceSpec?.isInterior === true;

  const cornerOn = (corners: CornerAtNode[]) =>
    corners.find((c) => c.regionId === faceSpec?.regionId) ?? null;
  const cornerA = cornerOn(cornersAtA);
  const cornerB = cornerOn(cornersAtB);

  const neighbourAt = (nodeId: string) => otherWallThicknessAt(nodeId, edge, edges, wallById);

  // When the user drew this face as its own contour, its extent is a fact we
  // can read straight off the drawing. Only a derived face has to infer how far
  // it wraps past each corner from the neighbouring wall's thickness.
  const drawn = faceSpec?.sourceWallId && face !== "faceA" ? projectedExtent(input) : null;
  const derivedA = extensionFor(cornersAtA, faceSpec?.regionId, neighbourAt(edge.nodeA));
  const derivedB = extensionFor(cornersAtB, faceSpec?.regionId, neighbourAt(edge.nodeB));

  // A room face always stops at its corner-panel leg. A non-room face normally
  // runs to the outer corner, but a re-entrant building corner folds inward on
  // that face and is therefore an inside formwork corner too.
  const cornerWidthAt = (
    corner: CornerAtNode | null,
    foldsInward: boolean,
    nodeId: string
  ): number => {
    if (bordersRoom) return corner ? (cornerPanelWidthById.get(corner.id) ?? 0) : 0;
    if (!foldsInward) return 0;
    return cornerPanelWidthById.get(exteriorCornerId(nodeId, faceSpec?.regionId)) ?? 0;
  };
  const consumedAtA = cornerWidthAt(cornerA, derivedA.cm < 0, edge.nodeA);
  const consumedAtB = cornerWidthAt(cornerB, derivedB.cm < 0, edge.nodeB);
  const extensionAtA = drawn?.startExtension ?? derivedA.cm;
  const extensionAtB = drawn?.endExtension ?? derivedB.cm;

  // The lap applies even when the far contour was drawn. The drawing says where
  // the concrete is; it says nothing about how two formwork panels are jointed,
  // and a plan must not bill differently for being traced twice.
  const lapAtA = derivedA.convex ? lapDelta(wallById.get(edge.wallId), rules) : 0;
  const lapAtB = derivedB.convex ? lapDelta(wallById.get(edge.wallId), rules) : 0;

  // The corner panel's leg is part of the wall, not extra to it: it fills the
  // first 30cm, the straight run takes the middle, and the far leg fills the
  // last 30cm. A 400 wall is 30 + 340 + 30 with nothing left over. Starting
  // the run at 0 instead pushed both legs off the ends of the wall and left a
  // 30cm hole at each end — which is what read as an unexplained gap.
  if (bordersRoom) {
    return {
      startOffset: consumedAtA,
      clearLength: Math.max(0, geometricLength - consumedAtA - consumedAtB),
      consumedAtA,
      consumedAtB,
      extensionAtA: 0,
      extensionAtB: 0,
      lapAtA: 0,
      lapAtB: 0,
    };
  }

  // The lap is a drafting detail on the existing end panels, not extra
  // tileable wall length. Adding it here changes panel selection and creates
  // artificial timber fillers (and therefore wrong BOM/accessory counts).
  const start = -extensionAtA + consumedAtA;
  const end = geometricLength + extensionAtB - consumedAtB;

  return {
    startOffset: start,
    clearLength: Math.max(0, Math.round(end - start)),
    consumedAtA,
    consumedAtB,
    extensionAtA,
    extensionAtB,
    lapAtA,
    lapAtB,
  };
}

/**
 * How far this face's own drawn contour reaches past each end of the
 * centerline, measured along the centerline's direction.
 */
function projectedExtent(
  input: FaceRunInput
): { startExtension: number; endExtension: number } | null {
  const face = input.resolvedWall.faces.find((f) => f.id === input.face);
  const [a, b] = input.resolvedWall.centerline;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!face || length === 0) return null;

  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const along = (p: { x: number; y: number }) => (p.x - a.x) * ux + (p.y - a.y) * uy;

  const ends = [along(face.line[0]), along(face.line[1])].sort((x, y) => x - y);
  return {
    startExtension: Math.round(-ends[0]!),
    endExtension: Math.round(ends[1]! - input.geometricLength),
  };
}

/** One physical corner-panel id shared by both legs on a non-room face. */
export function exteriorCornerId(nodeId: string, regionId: string | undefined): string {
  return `corner:${nodeId}:${regionId}`;
}

/** Whether this face forms a re-entrant, inside formwork corner at the node. */
export function faceFoldsInwardAt(
  corners: CornerAtNode[],
  regionId: string | undefined
): boolean {
  return extensionFor(corners, regionId, 1).cm < 0;
}

/**
 * How far past the drawn line a DERIVED face reaches at one end. Convex corners
 * push the outer face out by the neighbour's thickness; concave ones pull it in.
 */
function extensionFor(
  corners: CornerAtNode[],
  regionId: string | undefined,
  neighbourThickness: number
): { cm: number; convex: boolean } {
  // The face's own region has no corner here (a T junction, a free end, or a
  // straight join), so the face simply ends level with the drawn line.
  const roomCorner = corners[0];
  if (!roomCorner) return { cm: 0, convex: false };

  // Convex for the room on the far side means convex outward for this face.
  const convexForFarSide = corners.some((c) => c.regionId !== regionId && c.side === "outer");
  const concaveForFarSide = corners.some((c) => c.regionId !== regionId && c.side === "inner");

  if (convexForFarSide) return { cm: neighbourThickness, convex: true };
  if (concaveForFarSide) return { cm: -neighbourThickness, convex: false };
  return roomCorner.side === "outer"
    ? { cm: neighbourThickness, convex: true }
    : { cm: -neighbourThickness, convex: false };
}

/**
 * How far an outer face runs PAST its neighbour's outer face line at a convex
 * corner.
 *
 * Both walls run past — that is what closes the corner square, which is
 * otherwise reached by neither panel and leaves a hole in the formwork. They
 * run past by different amounts, and which gets which is decided by how the
 * wall lies:
 *
 * - the flatter wall by a full panel thickness, so it carries right across the
 *   panel it meets and covers the corner;
 * - the steeper wall by a panel thickness LESS the clearance, so it rides up
 *   over that panel and stops just short of its far edge, leaving the
 *   clearance showing.
 *
 * Steep-over-flat rather than a rotation around the contour: the crew builds
 * every corner the same way up, so all four corners of a room have to look
 * alike. A rotation alternates them, and two of the four then come out mirrored
 * from what is actually built.
 */
function lapDelta(wall: Wall | undefined, rules: AccessoryRules): number {
  const panel = rules.outerCornerProtrusionCm ?? 0;
  const clearance = rules.outerCornerLapGapCm ?? 0;
  if (!wall) return panel;

  const [a, b] = wall.innerLine;
  const steep = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
  return steep ? Math.max(0, panel - clearance) : panel;
}
