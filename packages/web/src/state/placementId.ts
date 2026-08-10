import type { Placement } from "@rastoplan/core";

/**
 * A fresh id for a hand-duplicated placement.
 *
 * Timestamps alone collide: two clicks inside the same millisecond produced
 * two placements with the same id, which React keys on and the reducer's
 * find-by-id then resolves to whichever came first.
 */
export function duplicatePlacementId(original: Placement): string {
  return `${original.id}:dup:${Math.random().toString(36).slice(2, 10)}`;
}
