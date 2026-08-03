import type { AccessoryRules, Panel, PanelCatalog } from "./types.js";

// RASTO's agreed-upon accessory engineering rules (spec section 4), calibrated
// against the customer's own BOM sheets — see docs/open-questions.md.
export const DEFAULT_ACCESSORY_RULES: AccessoryRules = {
  cornerClampsPerCorner: 3,
  clampsPerStraightJoint: 3,
  dywidagPerRod: 2,
  nutsPerDywidag: 2,
  dywidagStandardMaxThicknessCm: 30,
  strutSpacingCm: 150,
  craneAdaptersPerProject: 2,
  timberGapMin: 5,
  timberGapMax: 9,
  outerCornerProtrusionCm: 10,
  outerCornerProtrusionMinCm: 5,
  outerCornerProtrusionReferenceThicknessCm: 20,
  tilingPriority: ["leading", "min-panels", "min-gap"],
};

/**
 * Panel heights the Shiluvit B system is stocked in. The engine never reads
 * `Panel.height` — tiling is 1-D along the wall run — and every row in the
 * customer's BOM is a /300, so the catalog carries 300 only and the other
 * heights live here as reference data.
 */
export const AVAILABLE_PANEL_HEIGHTS = [300, 280, 140];

/**
 * Accessory catalog codes and the exact Hebrew labels the customer feeds into
 * Priority. Single source of truth for both the quantities panel and the BOM
 * export, so the two can't drift apart.
 */
export const ACCESSORY_ITEMS = {
  straightClamp: { code: "K10", label: "קלמרה רגילה לתבניות GT" },
  cornerClamp: { code: "K30", label: "קלמרה פינתית לתבניות GT" },
  craneAdapter: { code: "", label: "מתאם למנוף לתבניות רסטה" },
  walkway: { code: "", label: "הליכון(פיגום יציקה) לתבניות" },
  strut: { code: "", label: "רגל תמיכה ופילוס כפולה לתבניות" },
  dywidag: { code: "", label: "דיודגים" },
  nut: { code: "120S", label: "אומים" },
  nutAlt: { code: "70S", label: "אומים 70S" },
} as const;

/**
 * The Shiluvit B straight-panel widths, in cm. Single source of truth for the
 * default catalog AND the BOM export — the customer's Priority sheet has a
 * fixed row per width, so buildBomTemplate reads this list directly.
 */
export const STRAIGHT_PANEL_WIDTHS = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90] as const;

/** Corner-panel leg sizes (cm) that get a fixed row in the customer's BOM. */
export const BOM_CORNER_PANEL_LEGS = [20, 25, 30] as const;

const STRAIGHT_WIDTHS = STRAIGHT_PANEL_WIDTHS;

function straightPanel(width: number): Panel {
  return {
    type: `R${width}`,
    width,
    height: 300,
    isLeading: width === 75,
    inStock: true,
    kind: "straight",
    bomLabel: `פנאל ${width}/300`,
  };
}

function cornerPanel(leg: number, kind: "corner" | "corner-axial"): Panel {
  const axial = kind === "corner-axial";
  return {
    type: `${axial ? "A" : "C"}${leg}x${leg}`,
    width: leg,
    height: 300,
    secondLegWidth: leg,
    isLeading: !axial && leg === 30,
    inStock: true,
    kind,
    bomLabel: axial ? `פינה צירית ${leg}/${leg}/300` : `פנאל ${leg}/${leg}/300`,
  };
}

// The official Shiluvit B catalog. R75 and C30x30 are the customer's leading
// types; `isLeading` drives both the tiling tie-break and the corner-panel pick.
const DEFAULT_PANELS: Panel[] = [
  ...STRAIGHT_WIDTHS.map(straightPanel),
  cornerPanel(15, "corner"),
  cornerPanel(20, "corner"),
  cornerPanel(25, "corner"),
  cornerPanel(30, "corner"),
  cornerPanel(15, "corner-axial"),
  cornerPanel(30, "corner-axial"),
];

export const DEFAULT_PANEL_CATALOG: PanelCatalog = {
  panels: DEFAULT_PANELS,
};
