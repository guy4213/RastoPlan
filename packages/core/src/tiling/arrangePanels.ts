import type { Panel } from "../types.js";

export type ArrangedItem =
  | { kind: "panel"; width: number; offsetAlongEdge: number; panel: Panel }
  | { kind: "timber"; width: number; offsetAlongEdge: number };

/**
 * Orders selected panels left-to-right per the middle rule: sort
 * descending by width, then alternate panels outward-in onto a left and a
 * right pile (largest first on each side). Reassembling as
 * left + reverse(right) puts the biggest panels at the two ends and the
 * smallest at (or straddling) the center — with an even panel count there's
 * no single center slot, but the two smallest panels still land in the two
 * central positions, satisfying "closest to center" either way.
 *
 * The timber gap (if any) is inserted at that same center seam, so it
 * always sits immediately alongside the smallest/most-central panel.
 */
export function arrangePanels(selectedPanels: Panel[], gap: number): ArrangedItem[] {
  const sorted = [...selectedPanels].sort((a, b) => b.width - a.width);

  const left: Panel[] = [];
  const right: Panel[] = [];
  sorted.forEach((panel, i) => (i % 2 === 0 ? left : right).push(panel));

  const orderedPanels = [...left, ...right.slice().reverse()];
  const gapIndex = left.length; // the center seam between the two halves

  const items: ArrangedItem[] = [];
  let offset = 0;

  orderedPanels.forEach((panel, i) => {
    if (i === gapIndex && gap > 0) {
      items.push({ kind: "timber", width: gap, offsetAlongEdge: offset });
      offset += gap;
    }
    items.push({ kind: "panel", width: panel.width, offsetAlongEdge: offset, panel });
    offset += panel.width;
  });

  if (gap > 0 && gapIndex >= orderedPanels.length) {
    items.push({ kind: "timber", width: gap, offsetAlongEdge: offset });
  }

  return items;
}
