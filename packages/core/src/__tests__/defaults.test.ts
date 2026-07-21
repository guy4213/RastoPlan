import { describe, expect, it } from "vitest";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../defaults.js";

describe("DEFAULT_ACCESSORY_RULES", () => {
  it("matches RASTO's agreed engineering rules (spec section 4)", () => {
    expect(DEFAULT_ACCESSORY_RULES).toEqual({
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
    });
  });
});

describe("DEFAULT_PANEL_CATALOG", () => {
  it("includes the leading panels R75 and C30x30", () => {
    const leading = DEFAULT_PANEL_CATALOG.panels.filter((p) => p.isLeading);
    expect(leading.map((p) => p.type).sort()).toEqual(["C30x30", "R75"]);
  });
});
