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
  /** the face being tiled — the opposite one is mirrored by syncFacePlacements */
  side: PlacementSide;
  faceIsInterior: boolean;
}

/**
 * Tiles one straight edge: selects a panel combination, arranges it per the
 * middle rule, and returns full Placements on one face.
 *
 * The far face is not tiled here — it is mirrored at identical offsets by
 * syncFacePlacements, which is what keeps the Dywidag holes aligned.
 *
 * If no valid combination exists, returns a single Placement spanning the
 * whole edge, flagged 'gap-out-of-range', instead of an empty array — so
 * the failure is visible on the edge rather than silently absent.
 */
export function tileWall(
  edge: Edge,
  target: TileWallTarget,
  catalog: PanelCatalog,
  rules: AccessoryRules
): Placement[] {
  const selection = selectPanels(edge.clearLength, catalog, rules);
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
        id: `placement:${edge.id}:0`,
        kind: "timber",
        panelType: "",
        offsetAlongEdge: 0,
        width: edge.clearLength,
        flags: ["gap-out-of-range"],
      },
    ];
  }

  const arranged = arrangePanels(selection.panels, selection.gap);

  return arranged.map((item, index) => ({
    ...common,
    id: `placement:${edge.id}:${index}`,
    kind: item.kind,
    panelType: item.kind === "panel" ? item.panel.type : "timber",
    offsetAlongEdge: item.offsetAlongEdge,
    width: item.width,
    flags: [],
  }));
}
