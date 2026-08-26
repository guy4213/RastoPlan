import type { AccessoryRules, Edge, ExternalCorner, Placement, Wall } from "../types.js";
import type { AccessoryCount } from "./types.js";
import { collapsePlacementUnits } from "./units.js";
import { classifyDywidagLength, dywidagRodsForJoint } from "./dywidag.js";

/**
 * Counts every accessory line item from the CURRENT state of `placements`.
 *
 * The function is intentionally state-driven (not tiling-driven): once the
 * user hand-edits a placement in the canvas, calling this again will
 * reflect that edit. Nothing is memoized from a previous auto-tile.
 *
 * The clamp rules mirror the formulas in the customer's own BOM sheets:
 * - corner clamps (K30) = corner-panel units × 3 (their `=F27*3`). Every L
 *   corner carries one corner panel, so this is equivalently "3 per corner".
 * - straight clamps (K10) = straight panels × 3 (their
 *   `=((SUM(all panels))-4)*3`, where the 4 was the corner-panel count).
 *   Note this counts per PANEL, not per seam.
 *
 * Other assumptions:
 * - "tie point" for Dywidag = one per straight joint; the quantity rule
 *   itself is still open — see dywidag.ts.
 * - Struts are counted from `edges` (per-wall geometry), NOT per placement
 *   or per side. They apply to the inner side only.
 */
export function countAccessories(
  placements: Placement[],
  edges: Edge[],
  walls: Wall[],
  rules: AccessoryRules,
  externalCorners?: readonly ExternalCorner[]
): AccessoryCount {
  const units = collapsePlacementUnits(placements).filter(
    (p) => p.panelType && !p.flags.includes("outer-corner-protrusion")
  );
  const cornerUnits = units.filter((p) => p.kind === "corner-panel").length;
  const straightPanels = units.length - cornerUnits;

  const rods = countDywidagRods(placements, edges, walls, rules);
  const totalRods = rods.standard + rods.long;

  return {
    cornerClamps:
      (externalCorners ? externalCorners.length : cornerUnits) *
      rules.cornerClampsPerCorner,
    straightClamps: straightPanels * rules.clampsPerStraightJoint,
    dywidagRods: totalRods,
    dywidagRodsStandard: rods.standard,
    dywidagRodsLong: rods.long,
    nuts: totalRods * rules.nutsPerDywidag,
    struts: sumStruts(edges, rules.strutSpacingCm),
    craneAdapters: rules.craneAdaptersPerProject,
  };
}

/**
 * Panel-to-panel joints on face A only. Face B is a synced mirror at identical
 * offsets by construction, so counting both would double every physical seam.
 */
export function countStraightJoints(placements: Placement[]): number {
  let total = 0;
  for (const joints of straightJointsByEdge(placements).values()) total += joints;
  return total;
}

/**
 * Joints per edge, so Dywidag rod length can be resolved against that edge's
 * wall thickness. A corner panel butting against the first straight panel
 * counts: it is a real seam, clamped like any other.
 */
export function straightJointsByEdge(placements: Placement[]): Map<string, number> {
  const byEdge = new Map<string, Placement[]>();
  for (const p of placements) {
    if (p.side !== "faceA") continue;
    const arr = byEdge.get(p.edgeId) ?? [];
    arr.push(p);
    byEdge.set(p.edgeId, arr);
  }

  const joints = new Map<string, number>();
  for (const [edgeId, arr] of byEdge) {
    arr.sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);
    let count = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i]!;
      const b = arr[i + 1]!;
      // Widths and offsets are whole centimeters throughout the spec, so
      // exact equality — not tolerance — is the right adjacency test.
      if (a.offsetAlongEdge + a.width !== b.offsetAlongEdge) continue;
      if (a.kind === "timber" || b.kind === "timber") continue;
      count++;
    }
    joints.set(edgeId, count);
  }
  return joints;
}

export interface DywidagRodTally {
  standard: number;
  long: number;
}

/** Rods per edge, bucketed by the rod length that edge's wall thickness calls for. */
export function countDywidagRods(
  placements: Placement[],
  edges: Edge[],
  walls: Wall[],
  rules: AccessoryRules
): DywidagRodTally {
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const edgeById = new Map(edges.map((e) => [e.id, e]));

  const tally: DywidagRodTally = { standard: 0, long: 0 };
  for (const [edgeId, joints] of straightJointsByEdge(placements)) {
    const rods = joints * dywidagRodsForJoint(rules);
    const wall = wallById.get(edgeById.get(edgeId)?.wallId ?? "");
    if (classifyDywidagLength(wall?.thickness ?? 0, rules) === "long") tally.long += rods;
    else tally.standard += rods;
  }
  return tally;
}

function sumStruts(edges: Edge[], spacingCm: number): number {
  if (spacingCm <= 0) return 0;
  let total = 0;
  for (const edge of edges) {
    total += Math.ceil(edge.clearLength / spacingCm);
  }
  return total;
}
