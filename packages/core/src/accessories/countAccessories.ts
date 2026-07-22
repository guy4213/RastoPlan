import type { AccessoryRules, Edge, Node, Placement } from "../types.js";
import type { AccessoryCount } from "./types.js";

/**
 * Counts every accessory line item from the CURRENT state of `placements`.
 *
 * The function is intentionally state-driven (not tiling-driven): once the
 * user hand-edits a placement in the canvas, calling this again will
 * reflect that edit. Nothing is memoized from a previous auto-tile.
 *
 * Assumptions flagged in the session summary:
 * - "corner" = every graph node with type='L' (both inner and outer L). T
 *   and cross nodes carry an unresolved flag and are NOT counted here.
 * - "straight joint" = two consecutive placements on an edge's inner face
 *   with contiguous offsets AND kind='panel' on both sides. Corner-to-panel
 *   and panel-to-timber transitions do NOT count as straight joints
 *   (corner clamps cover the former; timber seams aren't panel-to-panel).
 * - "tie point" for Dywidag = one per straight joint (dywidagRods =
 *   joints × rules.dywidagPerRod). The spec's rules don't disambiguate
 *   between per-joint and per-panel-hole counting, so this is the choice
 *   that keeps rod count proportional to clampable seams.
 * - Struts are counted from `edges` (per-wall geometry), NOT per placement
 *   or per side. They apply to the inner side only.
 */
export function countAccessories(
  placements: Placement[],
  nodes: Node[],
  edges: Edge[],
  rules: AccessoryRules
): AccessoryCount {
  const corners = nodes.filter((n) => n.type === "L").length;
  const straightJoints = countStraightJoints(placements);
  const dywidagRods = straightJoints * rules.dywidagPerRod;

  return {
    cornerClamps: corners * rules.cornerClampsPerCorner,
    straightClamps: straightJoints * rules.clampsPerStraightJoint,
    dywidagRods,
    nuts: dywidagRods * rules.nutsPerDywidag,
    struts: sumStruts(edges, rules.strutSpacingCm),
    craneAdapters: rules.craneAdaptersPerProject,
  };
}

/**
 * Panel-to-panel joints on the INNER face only. The outer face is a synced
 * mirror of the inner (same offsets by construction) — counting both sides
 * would double every physical seam.
 */
export function countStraightJoints(placements: Placement[]): number {
  const byEdge = groupInnerPlacementsByEdge(placements);
  let joints = 0;
  for (const arr of byEdge.values()) {
    arr.sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i]!;
      const b = arr[i + 1]!;
      // Widths and offsets are whole centimeters throughout the spec, so
      // exact equality — not tolerance — is the right adjacency test.
      if (a.offsetAlongEdge + a.width !== b.offsetAlongEdge) continue;
      if (a.kind !== "panel" || b.kind !== "panel") continue;
      joints++;
    }
  }
  return joints;
}

function groupInnerPlacementsByEdge(placements: Placement[]): Map<string, Placement[]> {
  const byEdge = new Map<string, Placement[]>();
  for (const p of placements) {
    if (p.side !== "inner") continue;
    const arr = byEdge.get(p.edgeId) ?? [];
    arr.push(p);
    byEdge.set(p.edgeId, arr);
  }
  return byEdge;
}

function sumStruts(edges: Edge[], spacingCm: number): number {
  if (spacingCm <= 0) return 0;
  let total = 0;
  for (const edge of edges) {
    total += Math.ceil(edge.clearLength / spacingCm);
  }
  return total;
}
