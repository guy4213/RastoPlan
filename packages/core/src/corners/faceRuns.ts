import type { CornerAtNode, Edge, Node, PlacementSide, ResolvedWall, Wall } from "../types.js";
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
}

export interface FaceRunInput {
  edge: Edge;
  resolvedWall: ResolvedWall;
  face: PlacementSide;
  /** whole cm; the drawn line's length */
  geometricLength: number;
  cornersAtA: CornerAtNode[];
  cornersAtB: CornerAtNode[];
  cornerPanelWidth: number;
  /** overlap strip width at a convex corner on a face that borders no room */
  protrusionAtA: number;
  protrusionAtB: number;
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
    cornerPanelWidth,
    protrusionAtA,
    protrusionAtB,
    edges,
    wallById,
  } = input;

  const faceSpec = resolvedWall.faces.find((f) => f.id === face);
  const bordersRoom = faceSpec?.isInterior === true;

  const cornerOn = (corners: CornerAtNode[]) =>
    corners.find((c) => c.regionId === faceSpec?.regionId) ?? null;
  const cornerA = cornerOn(cornersAtA);
  const cornerB = cornerOn(cornersAtB);

  const neighbourAt = (nodeId: string) =>
    otherWallThicknessAt(nodeId, edge, edges, wallById);

  // A face that borders no room stops at the corner overlap; a face that
  // borders a room stops at its corner panel's leg.
  const consumedAtA = bordersRoom ? (cornerA ? cornerPanelWidth : 0) : protrusionAtA;
  const consumedAtB = bordersRoom ? (cornerB ? cornerPanelWidth : 0) : protrusionAtB;

  const extensionAtA = extensionFor(cornersAtA, faceSpec?.regionId, neighbourAt(edge.nodeA));
  const extensionAtB = extensionFor(cornersAtB, faceSpec?.regionId, neighbourAt(edge.nodeB));

  // The interior face keeps the historical frame exactly: its run starts at 0
  // and simply loses a leg at each end. Only the outer face needed a real
  // geometric extent, and moving the inner one would shift a calibrated result.
  if (bordersRoom) {
    return {
      startOffset: 0,
      clearLength: Math.max(0, geometricLength - consumedAtA - consumedAtB),
      consumedAtA,
      consumedAtB,
      extensionAtA: 0,
      extensionAtB: 0,
    };
  }

  const start = -extensionAtA + consumedAtA;
  const end = geometricLength + extensionAtB - consumedAtB;

  return {
    startOffset: start,
    clearLength: Math.max(0, Math.round(end - start)),
    consumedAtA,
    consumedAtB,
    extensionAtA,
    extensionAtB,
  };
}

/**
 * How far past the drawn line this face reaches at one end. Convex corners push
 * the outer face out by the neighbour's thickness; concave ones pull it in.
 */
function extensionFor(
  corners: CornerAtNode[],
  regionId: string | undefined,
  neighbourThickness: number
): number {
  // The face's own region has no corner here (a T junction, a free end, or a
  // straight join), so the face simply ends level with the drawn line.
  const roomCorner = corners[0];
  if (!roomCorner) return 0;

  // Convex for the room on the far side means convex outward for this face.
  const convexForFarSide = corners.some((c) => c.regionId !== regionId && c.side === "outer");
  const concaveForFarSide = corners.some((c) => c.regionId !== regionId && c.side === "inner");

  if (convexForFarSide) return neighbourThickness;
  if (concaveForFarSide) return -neighbourThickness;
  return roomCorner.side === "outer" ? neighbourThickness : -neighbourThickness;
}
