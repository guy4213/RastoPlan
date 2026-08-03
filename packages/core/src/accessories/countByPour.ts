import type { AccessoryRules, Edge, Placement, Wall } from "../types.js";
import type { AccessoryCount, CountByPour, PanelCount } from "./types.js";
import { countPanels } from "./countPanels.js";
import { collapsePlacementUnits } from "./units.js";
import { classifyDywidagLength, dywidagRodsForJoint } from "./dywidag.js";
import { straightJointsByEdge } from "./countAccessories.js";

/**
 * Same accessory count as `countAccessories`, but split per `pourId`.
 * The customer's bill of quantities shows quantities separately per pour
 * plus a totals column, which is what this shape maps to.
 *
 * Attribution: every line item now derives from placements, and a placement
 * carries its own `pourId`, so there are no heuristics left. A corner panel
 * spanning two pours collapses to a single leg first (lowest placement id),
 * which lands the unit in exactly one bucket — see units.ts.
 * Crane adapters remain project-scoped: 0 per pour, full count in `total`.
 */
export function countAccessoriesByPour(
  placements: Placement[],
  edges: Edge[],
  walls: Wall[],
  rules: AccessoryRules
): CountByPour<AccessoryCount> {
  const wallToPour = new Map(walls.map((w) => [w.id, w.pourId]));
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const edgeById = new Map(edges.map((e) => [e.id, e]));

  const byPour: Record<string, AccessoryCount> = {};
  for (const pourId of new Set(walls.map((w) => w.pourId))) {
    byPour[pourId] = emptyAccessoryCount();
  }
  const bucketFor = (pourId: string): AccessoryCount | undefined => byPour[pourId];

  // Clamps follow the customer's BOM formulas: K30 per corner-panel unit,
  // K10 per straight panel.
  for (const p of collapsePlacementUnits(placements)) {
    if (!p.panelType || p.flags.includes("outer-corner-protrusion")) continue;
    const bucket = bucketFor(p.pourId);
    if (!bucket) continue;
    if (p.kind === "corner-panel") bucket.cornerClamps += rules.cornerClampsPerCorner;
    else bucket.straightClamps += rules.clampsPerStraightJoint;
  }

  // Dywidag + nuts per edge, with the rod length set by that wall's thickness.
  for (const [edgeId, joints] of straightJointsByEdge(placements)) {
    const wallId = edgeById.get(edgeId)?.wallId;
    if (!wallId) continue;
    const bucket = bucketFor(wallToPour.get(wallId) ?? "");
    if (!bucket) continue;

    const rods = joints * dywidagRodsForJoint(rules);
    const thickness = wallById.get(wallId)?.thickness ?? 0;
    if (classifyDywidagLength(thickness, rules) === "long") bucket.dywidagRodsLong += rods;
    else bucket.dywidagRodsStandard += rods;
    bucket.dywidagRods += rods;
    bucket.nuts += rods * rules.nutsPerDywidag;
  }

  // Struts per edge → per pour.
  for (const edge of edges) {
    const bucket = bucketFor(wallToPour.get(edge.wallId) ?? "");
    if (!bucket) continue;
    if (rules.strutSpacingCm > 0) {
      bucket.struts += Math.ceil(edge.clearLength / rules.strutSpacingCm);
    }
  }

  const total = emptyAccessoryCount();
  for (const bucket of Object.values(byPour)) {
    total.cornerClamps += bucket.cornerClamps;
    total.straightClamps += bucket.straightClamps;
    total.dywidagRods += bucket.dywidagRods;
    total.dywidagRodsStandard += bucket.dywidagRodsStandard;
    total.dywidagRodsLong += bucket.dywidagRodsLong;
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

  // Collapse first so a corner unit spanning two pours isn't counted twice.
  const grouped = new Map<string, Placement[]>();
  for (const p of collapsePlacementUnits(placements)) {
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
    dywidagRodsStandard: 0,
    dywidagRodsLong: 0,
    nuts: 0,
    struts: 0,
    craneAdapters: 0,
  };
}

function emptyPanelCount(): PanelCount {
  return { byType: {}, timberPieces: 0, timberLengthCm: 0 };
}
