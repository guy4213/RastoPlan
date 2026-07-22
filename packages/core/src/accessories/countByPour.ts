import type { AccessoryRules, Edge, Node, Placement, Wall } from "../types.js";
import type { AccessoryCount, CountByPour, PanelCount } from "./types.js";
import { countPanels } from "./countPanels.js";

/**
 * Same accessory count as `countAccessories`, but split per `pourId`.
 * The customer's bill of quantities shows quantities separately per pour
 * plus a totals column, which is what this shape maps to.
 *
 * Attribution rules (flagged in the session summary):
 * - Straight clamps / Dywidag / nuts: attributed to the placement's own
 *   `pourId` (unambiguous — both sides of a joint share a wall).
 * - Struts: attributed to the edge's wall's pourId.
 * - Corner clamps: an L node can sit between edges belonging to different
 *   pours. We attribute the corner to the pour of the lowest-id incident
 *   edge (deterministic tiebreak). Multi-pour corners are unusual — pours
 *   are normally contiguous regions — but the attribution is documented so
 *   the accounting matches expectations.
 * - Crane adapters: project-scoped, not per pour. perPour value is 0 for
 *   every pour; `total.craneAdapters` holds the full project count.
 */
export function countAccessoriesByPour(
  placements: Placement[],
  nodes: Node[],
  edges: Edge[],
  walls: Wall[],
  rules: AccessoryRules
): CountByPour<AccessoryCount> {
  const wallToPour = new Map(walls.map((w) => [w.id, w.pourId]));
  const edgeToPour = new Map<string, string>();
  for (const edge of edges) {
    const pour = wallToPour.get(edge.wallId);
    if (pour) edgeToPour.set(edge.id, pour);
  }

  const pourIds = new Set<string>(walls.map((w) => w.pourId));
  const byPour: Record<string, AccessoryCount> = {};
  for (const pourId of pourIds) byPour[pourId] = emptyAccessoryCount();

  // Corner clamps — attribute each L node to its lowest-id incident edge's pour.
  for (const node of nodes) {
    if (node.type !== "L") continue;
    const incidentEdges = edges
      .filter((e) => e.nodeA === node.id || e.nodeB === node.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    const anchor = incidentEdges[0];
    if (!anchor) continue;
    const pourId = edgeToPour.get(anchor.id);
    if (pourId && byPour[pourId]) {
      byPour[pourId].cornerClamps += rules.cornerClampsPerCorner;
    }
  }

  // Straight joints per pour — walked per-edge on the inner face only.
  const jointsByPour = new Map<string, number>();
  const jointsByEdge = new Map<string, Placement[]>();
  for (const p of placements) {
    if (p.side !== "inner") continue;
    const arr = jointsByEdge.get(p.edgeId) ?? [];
    arr.push(p);
    jointsByEdge.set(p.edgeId, arr);
  }
  for (const arr of jointsByEdge.values()) {
    arr.sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i]!;
      const b = arr[i + 1]!;
      if (a.offsetAlongEdge + a.width !== b.offsetAlongEdge) continue;
      if (a.kind !== "panel" || b.kind !== "panel") continue;
      jointsByPour.set(a.pourId, (jointsByPour.get(a.pourId) ?? 0) + 1);
    }
  }
  for (const [pourId, joints] of jointsByPour) {
    const bucket = byPour[pourId];
    if (!bucket) continue;
    bucket.straightClamps += joints * rules.clampsPerStraightJoint;
    bucket.dywidagRods += joints * rules.dywidagPerRod;
    bucket.nuts += joints * rules.dywidagPerRod * rules.nutsPerDywidag;
  }

  // Struts per edge → per pour.
  for (const edge of edges) {
    const pourId = edgeToPour.get(edge.id);
    if (!pourId || !byPour[pourId]) continue;
    if (rules.strutSpacingCm > 0) {
      byPour[pourId].struts += Math.ceil(edge.clearLength / rules.strutSpacingCm);
    }
  }

  const total = emptyAccessoryCount();
  for (const bucket of Object.values(byPour)) {
    total.cornerClamps += bucket.cornerClamps;
    total.straightClamps += bucket.straightClamps;
    total.dywidagRods += bucket.dywidagRods;
    total.nuts += bucket.nuts;
    total.struts += bucket.struts;
  }
  // Crane adapters live only in the project-wide total — see attribution notes.
  total.craneAdapters = rules.craneAdaptersPerProject;

  return { byPour, total };
}

/**
 * Panel and timber counts split per pour, with a project total. Uses the
 * same rules as `countPanels` for what to include; attribution is by
 * placement.pourId, which is set at panel creation and doesn't need
 * heuristic tiebreaks.
 */
export function countPanelsByPour(
  placements: Placement[],
  walls: Wall[]
): CountByPour<PanelCount> {
  const pourIds = new Set<string>(walls.map((w) => w.pourId));
  const byPour: Record<string, PanelCount> = {};
  for (const pourId of pourIds) byPour[pourId] = emptyPanelCount();

  const grouped = new Map<string, Placement[]>();
  for (const p of placements) {
    if (!byPour[p.pourId]) byPour[p.pourId] = emptyPanelCount();
    const arr = grouped.get(p.pourId) ?? [];
    arr.push(p);
    grouped.set(p.pourId, arr);
  }
  for (const [pourId, arr] of grouped) {
    byPour[pourId] = countPanels(arr);
  }

  const total = emptyPanelCount();
  for (const bucket of Object.values(byPour)) {
    total.timberPieces += bucket.timberPieces;
    total.timberLengthCm += bucket.timberLengthCm;
    for (const [type, count] of Object.entries(bucket.byType)) {
      total.byType[type] = (total.byType[type] ?? 0) + count;
    }
  }

  return { byPour, total };
}

function emptyAccessoryCount(): AccessoryCount {
  return {
    cornerClamps: 0,
    straightClamps: 0,
    dywidagRods: 0,
    nuts: 0,
    struts: 0,
    craneAdapters: 0,
  };
}

function emptyPanelCount(): PanelCount {
  return { byType: {}, timberPieces: 0, timberLengthCm: 0 };
}
