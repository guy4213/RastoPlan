import type { Placement } from "../types.js";

/**
 * Collapses placements that are legs of one physical unit down to a single
 * representative, so counting (and pour attribution) treats them as the one
 * item they are.
 *
 * Today only corner panels are multi-leg: one C30x30 wraps a corner and is
 * emitted once per meeting wall. A corner can sit between two different
 * pours, so the representative is chosen by lowest placement id — a stable
 * tiebreak that also keeps the unit inside exactly one pour bucket.
 */
export function collapsePlacementUnits(placements: Placement[]): Placement[] {
  const representatives = new Map<string, Placement>();
  const singles: Placement[] = [];

  for (const p of placements) {
    if (!p.groupId) {
      singles.push(p);
      continue;
    }
    // Keyed on groupId alone: `side` is wall-LOCAL, so at a corner between two
    // walls one leg can sit on faceA and the other on faceB of walls whose A→B
    // directions differ. groupId (`corner:${node}:${region}`) is already unique
    // per physical unit, which is the only thing that must not be double-counted.
    const current = representatives.get(p.groupId);
    if (!current || p.id < current.id) representatives.set(p.groupId, p);
  }

  return [...singles, ...representatives.values()];
}

/** Physical corner-panel units (not legs) in the placement set. */
export function countCornerUnits(placements: Placement[]): number {
  return collapsePlacementUnits(placements).filter((p) => p.kind === "corner-panel").length;
}
