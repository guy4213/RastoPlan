import type { Wall } from "../types.js";
import type { ResolveOptions } from "./constants.js";
import { resolveWalls } from "./resolveWalls.js";

/** Two drawn lines the engine is confident are the two faces of one wall. */
export interface WallPairPreview {
  /** the contour the engine kept as the primary */
  wallId: string;
  /** the contour that turned out to be its far face */
  partnerId: string;
  /** the distance actually between them, which IS the wall thickness */
  thicknessCm: number;
}

/**
 * The pairings and measured thicknesses alone, without tiling anything.
 *
 * Thickness is a fact about the drawing, not about the layout: the moment the
 * second contour closes, the distance between the two lines is knowable, and
 * making the engineer press "compute" to see it — or to edit it — is a detour
 * through the expensive half of the engine for an answer the cheap half
 * already has.
 *
 * Deliberately a projection over `resolveWalls` rather than its own matcher:
 * `resolveWalls` IS the geometry half (graph, planar faces, regions, pairing)
 * and stops short of tiling and the bill of materials. Re-implementing the
 * pairing rules here would give the canvas and the BOM two different opinions
 * about what counts as one wall, which is the exact class of bug this layer
 * exists to prevent.
 *
 * Only pairings on CLOSED contours come back: every endpoint of both walls has
 * to meet another wall. A plan being drawn is a plan with loose ends, and while
 * those exist the engine will read two unrelated strokes as the faces of one
 * wall — on a half-drawn L it paired walls metres apart, which greyed them out
 * as "already someone else's far face" and flipped the side their length labels
 * sit on. Waiting for the ends to join costs nothing, because the measurement
 * only means anything once the contour exists, and it is what makes this safe
 * to run on every edit.
 *
 * Deliberately stricter than the full pipeline: resolveWalls still decides for
 * itself at compute time. Preview declines to answer early; it never disagrees.
 */
export function previewPairings(walls: Wall[], options: ResolveOptions = {}): WallPairPreview[] {
  const { resolvedWalls, edges } = resolveWalls(walls, options);

  const degree = new Map<string, number>();
  for (const edge of edges) {
    for (const nodeId of [edge.nodeA, edge.nodeB]) {
      degree.set(nodeId, (degree.get(nodeId) ?? 0) + 1);
    }
  }

  const edgeByWallId = new Map(edges.map((e) => [e.wallId, e]));
  const isClosed = (wallId: string): boolean => {
    const edge = edgeByWallId.get(wallId);
    if (!edge) return false;
    return (degree.get(edge.nodeA) ?? 0) > 1 && (degree.get(edge.nodeB) ?? 0) > 1;
  };

  return resolvedWalls.flatMap((resolved) => {
    if (resolved.thicknessSource !== "measured") return [];
    const partnerId = resolved.consumedWallIds[0];
    if (!partnerId) return [];
    if (!isClosed(resolved.sourceWallId) || !isClosed(partnerId)) return [];

    return [{ wallId: resolved.sourceWallId, partnerId, thicknessCm: resolved.thickness }];
  });
}

/**
 * The same pairings keyed by wall id, from BOTH sides, so a lookup works
 * whichever of the two contours the user happens to have selected.
 */
export function previewPairingByWallId(
  walls: Wall[],
  options: ResolveOptions = {}
): Map<string, { partnerId: string; thicknessCm: number }> {
  const byWallId = new Map<string, { partnerId: string; thicknessCm: number }>();

  for (const pair of previewPairings(walls, options)) {
    byWallId.set(pair.wallId, { partnerId: pair.partnerId, thicknessCm: pair.thicknessCm });
    byWallId.set(pair.partnerId, { partnerId: pair.wallId, thicknessCm: pair.thicknessCm });
  }
  return byWallId;
}
