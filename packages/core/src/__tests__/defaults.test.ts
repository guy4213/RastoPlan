import { describe, expect, it } from "vitest";
import {
  ACCESSORY_ITEMS,
  AVAILABLE_PANEL_HEIGHTS,
  DEFAULT_ACCESSORY_RULES,
  DEFAULT_PANEL_CATALOG,
} from "../defaults.js";

describe("DEFAULT_ACCESSORY_RULES", () => {
  it("matches RASTO's agreed engineering rules (spec section 4)", () => {
    expect(DEFAULT_ACCESSORY_RULES).toEqual({
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
      outerCornerLapGapCm: 2,
      tilingPriority: ["leading", "min-panels", "min-gap"],
    });
  });
});

describe("DEFAULT_PANEL_CATALOG", () => {
  it("includes the leading panels R75 and C30x30", () => {
    const leading = DEFAULT_PANEL_CATALOG.panels.filter((p) => p.isLeading);
    expect(leading.map((p) => p.type).sort()).toEqual(["C30x30", "R75"]);
  });

  it("stocks every straight width from 20 to 90 in 5cm steps (official Shiluvit B list)", () => {
    const widths = DEFAULT_PANEL_CATALOG.panels
      .filter((p) => p.kind === "straight")
      .map((p) => p.width)
      .sort((a, b) => a - b);
    expect(widths).toEqual([20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]);
  });

  it("stocks the four inner corner sizes and the two axial ones", () => {
    const typesOfKind = (kind: string) =>
      DEFAULT_PANEL_CATALOG.panels
        .filter((p) => p.kind === kind)
        .map((p) => p.type)
        .sort();

    expect(typesOfKind("corner")).toEqual(["C15x15", "C20x20", "C25x25", "C30x30"]);
    expect(typesOfKind("corner-axial")).toEqual(["A15x15", "A30x30"]);
  });

  it("carries the exact BOM row label the customer's Priority sheet uses", () => {
    const byType = new Map(DEFAULT_PANEL_CATALOG.panels.map((p) => [p.type, p]));
    expect(byType.get("R75")?.bomLabel).toBe("פנאל 75/300");
    expect(byType.get("C30x30")?.bomLabel).toBe("פנאל 30/30/300");
    expect(byType.get("A15x15")?.bomLabel).toBe("פינה צירית 15/15/300");
  });

  it("records both legs of a corner panel — its BOM area covers the pair", () => {
    const c30 = DEFAULT_PANEL_CATALOG.panels.find((p) => p.type === "C30x30");
    expect(c30?.width).toBe(30);
    expect(c30?.secondLegWidth).toBe(30);
  });

  it("carries only the 300 height; the other stocked heights are reference data", () => {
    expect(DEFAULT_PANEL_CATALOG.panels.every((p) => p.height === 300)).toBe(true);
    expect(AVAILABLE_PANEL_HEIGHTS).toEqual([300, 280, 140]);
  });
});

describe("ACCESSORY_ITEMS", () => {
  it("maps the clamp and nut catalog codes the customer uses", () => {
    expect(ACCESSORY_ITEMS.straightClamp.code).toBe("K10");
    expect(ACCESSORY_ITEMS.cornerClamp.code).toBe("K30");
    expect(ACCESSORY_ITEMS.nut.code).toBe("120S");
    expect(ACCESSORY_ITEMS.nutAlt.code).toBe("70S");
  });

  it("uses the exact Hebrew BOM labels, which are what Priority ingests", () => {
    expect(ACCESSORY_ITEMS.straightClamp.label).toBe("קלמרה רגילה לתבניות GT");
    expect(ACCESSORY_ITEMS.cornerClamp.label).toBe("קלמרה פינתית לתבניות GT");
  });
});
