import type { Placement, Wall } from "../types.js";
import type { PanelCount } from "./types.js";
import { collapsePlacementUnits } from "./units.js";

/** Panel and timber quantities separated by the face that carries each unit. */
export interface PanelCountByFace {
  interior: PanelCount;
  exterior: PanelCount;
  total: PanelCount;
}

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

/**
 * Counts panels and timber by room-facing versus non-room-facing placement.
 *
 * A grouped corner panel is one physical unit. It is first collapsed using
 * `collapsePlacementUnits`, then assigned to the bucket of that helper's
 * canonical (lowest-id) representative. This intentionally makes a mixed-face
 * legacy group deterministic while ensuring it appears once, including in
 * `total`. Face membership always uses `faceIsInterior`; `side` only identifies
 * a wall-local geometric face and must not be used for this classification.
 */
export function countPanelsByFace(
  placements: Placement[],
  _walls: readonly Wall[]
): PanelCountByFace {
  const interior: Placement[] = [];
  const exterior: Placement[] = [];

  for (const p of collapsePlacementUnits(placements)) {
    (p.faceIsInterior ? interior : exterior).push(p);
  }

  const interiorCount = countPanels(interior);
  const exteriorCount = countPanels(exterior);
  return {
    interior: interiorCount,
    exterior: exteriorCount,
    total: addPanelCounts(interiorCount, exteriorCount),
  };
}

function addPanelCounts(a: PanelCount, b: PanelCount): PanelCount {
  const byType: Record<string, number> = { ...a.byType };
  for (const [type, count] of Object.entries(b.byType)) {
    byType[type] = (byType[type] ?? 0) + count;
  }
  return {
    byType,
    timberPieces: a.timberPieces + b.timberPieces,
    timberLengthCm: a.timberLengthCm + b.timberLengthCm,
  };
}
