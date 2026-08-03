import type { Placement } from "../types.js";
import type { PanelCount } from "./types.js";
import { collapsePlacementUnits } from "./units.js";

/**
 * Counts physical panels and timber pieces from the current placement set.
 *
 * Both inner and outer face placements are counted — they are separate
 * physical objects (the inner-face panel and its outer-face mate). Two
 * exceptions:
 * - `outer-corner-protrusion` markers model the overlap of an existing
 *   terminal panel, not a standalone panel, and are skipped.
 * - a corner panel wraps the corner and emits one leg per meeting wall; the
 *   legs collapse to the one panel they are, which is what makes a 4-corner
 *   room report 4 corner panels like the customer's BOM does.
 */
export function countPanels(placements: Placement[]): PanelCount {
  const byType: Record<string, number> = {};
  let timberPieces = 0;
  let timberLengthCm = 0;

  for (const p of collapsePlacementUnits(placements)) {
    if (p.flags.includes("outer-corner-protrusion")) continue;
    if (p.kind === "timber") {
      timberPieces += 1;
      timberLengthCm += p.width;
    } else if (p.panelType) {
      byType[p.panelType] = (byType[p.panelType] ?? 0) + 1;
    }
  }

  return { byType, timberPieces, timberLengthCm };
}
