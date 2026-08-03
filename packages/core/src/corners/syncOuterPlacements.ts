import type { Placement } from "../types.js";

/**
 * Mirrors an edge's inner-face placements onto the outer face, preserving
 * every offsetAlongEdge exactly.
 *
 * This is the Dywidag-alignment invariant: tie rods pass perpendicularly
 * from inner to outer through hole patterns fixed on each panel — if the
 * outer joints don't line up with the inner joints along the wall, the rod
 * hits solid panel instead of a hole and can't be threaded. We therefore do
 * NOT re-tile the outer face independently; we clone the inner arrangement
 * and just flip `side` and reissue ids. `source`, `flags`, and every
 * geometric field carry over unchanged.
 */
export function syncOuterPlacements(innerPlacements: Placement[]): Placement[] {
  return innerPlacements.map((p, i) => ({
    ...p,
    id: `${p.id}:outer:${i}`,
    side: "outer",
  }));
}
