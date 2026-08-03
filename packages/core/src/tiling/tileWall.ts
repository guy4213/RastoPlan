import type { AccessoryRules, Edge, PanelCatalog, Placement } from "../types.js";
import { selectPanels } from "./selectPanels.js";
import { arrangePanels } from "./arrangePanels.js";

/**
 * Tiles one straight edge: selects a panel combination, arranges it per the
 * middle rule, and returns full Placements.
 *
 * `pourId` isn't on Edge (only `wallId` is) — the caller resolves it from
 * the owning Wall. All Placements use side='inner'; the outer face is
 * Milestone 2's next layer.
 *
 * If no valid combination exists, returns a single Placement spanning the
 * whole edge, flagged 'gap-out-of-range', instead of an empty array — so
 * the failure is visible on the edge rather than silently absent.
 */
export function tileWall(
  edge: Edge,
  pourId: string,
  catalog: PanelCatalog,
  rules: AccessoryRules
): Placement[] {
  const selection = selectPanels(edge.clearLength, catalog, rules);

  if (selection.flags.includes("gap-out-of-range")) {
    return [
      {
        id: `placement:${edge.id}:0`,
        edgeId: edge.id,
        pourId,
        side: "inner",
        kind: "timber",
        panelType: "",
        offsetAlongEdge: 0,
        width: edge.clearLength,
        source: "auto",
        flags: ["gap-out-of-range"],
      },
    ];
  }

  const arranged = arrangePanels(selection.panels, selection.gap);

  return arranged.map((item, index) => ({
    id: `placement:${edge.id}:${index}`,
    edgeId: edge.id,
    pourId,
    side: "inner",
    kind: item.kind,
    panelType: item.kind === "panel" ? item.panel.type : "timber",
    offsetAlongEdge: item.offsetAlongEdge,
    width: item.width,
    source: "auto",
    flags: [],
  }));
}
