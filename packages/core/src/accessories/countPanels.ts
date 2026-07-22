import type { Placement } from "../types.js";
import type { PanelCount } from "./types.js";

/**
 * Counts physical panels and timber pieces from the current placement set.
 *
 * Both inner and outer face placements are counted — they are separate
 * physical objects (the inner-face panel and its outer-face mate). The
 * only exception is `outer-corner-protrusion` markers, which model the
 * 10cm overhang of an existing terminal panel and are not standalone
 * panels themselves; they're skipped.
 */
export function countPanels(placements: Placement[]): PanelCount {
  const byType: Record<string, number> = {};
  let timberPieces = 0;
  let timberLengthCm = 0;

  for (const p of placements) {
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
