import type { AccessoryRules, Panel, PanelCatalog } from "./types.js";

// RASTO's agreed-upon accessory engineering rules (spec section 4).
export const DEFAULT_ACCESSORY_RULES: AccessoryRules = {
  cornerClampsPerCorner: 3,
  clampsPerStraightJoint: 3,
  dywidagPerRod: 2,
  nutsPerDywidag: 2,
  strutSpacingCm: 150,
  craneAdaptersPerProject: 2,
  timberGapMin: 5,
  timberGapMax: 9,
  outerCornerProtrusionCm: 10,
  tilingPriority: ["leading", "min-panels", "min-gap"],
};

// Reasonable default panel catalog. Exact widths and stock are finalized
// per project — see spec section 4.
const DEFAULT_PANELS: Panel[] = [
  { type: "R75", width: 75, height: 300, isLeading: true, inStock: true },
  { type: "C30x30", width: 30, height: 300, isLeading: true, inStock: true },
  { type: "R60", width: 60, height: 300, isLeading: false, inStock: true },
  { type: "R55", width: 55, height: 300, isLeading: false, inStock: true },
  { type: "R50", width: 50, height: 300, isLeading: false, inStock: true },
  { type: "R40", width: 40, height: 300, isLeading: false, inStock: true },
];

export const DEFAULT_PANEL_CATALOG: PanelCatalog = {
  panels: DEFAULT_PANELS,
};
