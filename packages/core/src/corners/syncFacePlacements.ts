import type { Placement, PlacementSide } from "../types.js";

/**
 * Mirrors one face's placements onto the opposite face, preserving every
 * offsetAlongEdge exactly.
 *
 * This is the Dywidag-alignment invariant: tie rods pass perpendicularly
 * through hole patterns fixed on each panel, so if the two faces' joints don't
 * line up along the wall, the rod hits solid panel instead of a hole. We
 * therefore do NOT re-tile the far face independently. The invariant is
 * face-agnostic — the rod goes through the wall whether the far side is another
 * room or the outside.
 */
export function syncFacePlacements(
  source: Placement[],
  targetFace: PlacementSide,
  targetFaceIsInterior: boolean
): Placement[] {
  return source.map((p, i) => ({
    ...p,
    id: `${p.id}:${targetFace}:${i}`,
    side: targetFace,
    faceIsInterior: targetFaceIsInterior,
  }));
}
