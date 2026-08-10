import type {
  AccessoryRules,
  Edge,
  PanelCatalog,
  Placement,
  PlacementSide,
} from "../types.js";
import { selectPanels } from "./selectPanels.js";
import { arrangePanels } from "./arrangePanels.js";

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
 * Tiles one face of one edge: selects a panel combination, arranges it per the
 * middle rule, and returns full Placements.
 *
 * Each face is tiled on its own run. They cannot share one: a room's outer ring
 * is longer than its inner ring by the neighbouring walls' thickness at every
 * corner, so mirroring the inner layout outward leaves the outer face short by
 * exactly that much.
 *
 * If no valid combination exists, returns a single Placement spanning the
 * whole run, flagged 'gap-out-of-range', instead of an empty array — so
 * the failure is visible on the edge rather than silently absent.
 */
export function tileWall(
  edge: Edge,
  target: TileWallTarget,
  catalog: PanelCatalog,
  rules: AccessoryRules
): Placement[] {
  const selection = selectPanels(target.clearLength, catalog, rules);
  const common = {
    edgeId: edge.id,
    wallId: target.wallId,
    pourId: target.pourId,
    side: target.side,
    faceIsInterior: target.faceIsInterior,
    source: "auto" as const,
  };

  if (selection.flags.includes("gap-out-of-range")) {
    return [
      {
        ...common,
        id: `placement:${edge.id}:${target.side}:0`,
        kind: "timber",
        panelType: "",
        offsetAlongEdge: target.startOffset,
        width: target.clearLength,
        flags: ["gap-out-of-range"],
      },
    ];
  }

  const arranged = arrangePanels(selection.panels, selection.gap);

  return arranged.map((item, index) => ({
    ...common,
    id: `placement:${edge.id}:${target.side}:${index}`,
    kind: item.kind,
    panelType: item.kind === "panel" ? item.panel.type : "timber",
    offsetAlongEdge: target.startOffset + item.offsetAlongEdge,
    width: item.width,
    flags: [],
  }));
}
