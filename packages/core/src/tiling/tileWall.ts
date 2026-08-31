import type {
  AccessoryRules,
  Edge,
  PanelCatalog,
  Placement,
  PlacementSide,
} from "../types.js";
import { selectPanels } from "./selectPanels.js";
import type { PanelAvailability } from "./selectPanels.js";
import { arrangePanels } from "./arrangePanels.js";
import type { ArrangedItem } from "./arrangePanels.js";

export interface TileWallTarget {
  /** the ResolvedWall this edge belongs to */
  wallId: string;
  pourId: string;
  side: PlacementSide;
  faceIsInterior: boolean;
  /**
   * Length of THIS face's straight run. The two faces of a wall differ: the
   * outer one wraps past each convex corner by the neighbour's thickness.
   */
  clearLength: number;
  /**
   * Where that run begins in the wall's along-axis frame. Negative for an
   * outer face, which starts before the drawn line does.
   */
  startOffset: number;
}

/**
 * A chosen panel layout for one straight run, before it is attached to a face.
 *
 * Kept separate from the Placements it becomes so that a run shared by both
 * faces of a wall is *selected once* and materialised twice. Selecting per face
 * and hoping the two agree is exactly what left the inner and outer joints
 * offset from each other; with one plan behind both rows they cannot diverge.
 */
export interface RunPlan {
  items: ArrangedItem[];
  /** ["gap-out-of-range"] when no combination fits; `items` is empty then */
  flags: string[];
  /** how many units of each type the selection could not source from stock */
  missingPanelsByType: Readonly<Record<string, number>>;
  /** the run this plan covers, as handed in */
  clearLength: number;
}

export interface MaterialiseTarget extends TileWallTarget {
  edgeId: string;
  /** first index used in generated placement ids, so segments of one face don't collide */
  indexOffset?: number;
}

/**
 * Chooses the panel combination for a run and orders it per the middle rule.
 * Pure: the same arguments always produce the same plan.
 */
export function planRun(
  clearLength: number,
  catalog: PanelCatalog,
  rules: AccessoryRules,
  availability?: PanelAvailability
): RunPlan {
  const selection = selectPanels(clearLength, catalog, rules, availability);
  return {
    items: selection.flags.length > 0 ? [] : arrangePanels(selection.panels, selection.gap),
    flags: selection.flags,
    missingPanelsByType: selection.missingPanelsByType,
    clearLength,
  };
}

/**
 * Turns a plan into Placements on one face.
 *
 * If the plan failed, returns a single Placement spanning the whole run flagged
 * 'gap-out-of-range' instead of an empty array — so the failure is visible on
 * the edge rather than silently absent.
 */
export function materialiseRun(plan: RunPlan, target: MaterialiseTarget): Placement[] {
  const base = target.indexOffset ?? 0;
  const common = {
    edgeId: target.edgeId,
    wallId: target.wallId,
    pourId: target.pourId,
    side: target.side,
    faceIsInterior: target.faceIsInterior,
    source: "auto" as const,
  };

  if (plan.flags.length > 0) {
    return [
      {
        ...common,
        id: `placement:${target.edgeId}:${target.side}:${base}`,
        kind: "timber",
        panelType: "",
        offsetAlongEdge: target.startOffset,
        width: target.clearLength,
        flags: plan.flags,
      },
    ];
  }

  // Keep real and missing units as separate placements. The selector returns
  // a complete layout even when stock is short; only counts beyond the
  // available quantity receive the red inventory flag on the canvas. The tally
  // is rebuilt per materialisation, so both faces of a shared run report the
  // same shortage rather than the second one inheriting a spent counter.
  const stockedRemaining: Record<string, number> = {};
  for (const item of plan.items) {
    if (item.kind !== "panel") continue;
    stockedRemaining[item.panel.type] = (stockedRemaining[item.panel.type] ?? 0) + 1;
  }
  for (const [type, missing] of Object.entries(plan.missingPanelsByType)) {
    stockedRemaining[type] = Math.max(0, (stockedRemaining[type] ?? 0) - missing);
  }

  return plan.items.map((item, index) => {
    const panelType = item.kind === "panel" ? item.panel.type : "timber";
    const stocked = item.kind === "panel" && (stockedRemaining[panelType] ?? 0) > 0;
    if (stocked) stockedRemaining[panelType] = (stockedRemaining[panelType] ?? 0) - 1;
    return {
      ...common,
      id: `placement:${target.edgeId}:${target.side}:${base + index}`,
      kind: item.kind,
      panelType,
      offsetAlongEdge: target.startOffset + item.offsetAlongEdge,
      width: item.width,
      flags: item.kind === "panel" && !stocked ? ["inventory-shortage"] : [],
    };
  });
}

/**
 * Tiles one face of one edge: selects a panel combination, arranges it per the
 * middle rule, and returns full Placements.
 *
 * This is the single-row path — a wall the user drew as one line. A wall drawn
 * as two contours goes through tileWallPair instead, which shares one plan
 * across both faces so their joints line up.
 */
export function tileWall(
  edge: Edge,
  target: TileWallTarget,
  catalog: PanelCatalog,
  rules: AccessoryRules,
  availability?: PanelAvailability
): Placement[] {
  const plan = planRun(target.clearLength, catalog, rules, availability);
  return materialiseRun(plan, { ...target, edgeId: edge.id });
}
