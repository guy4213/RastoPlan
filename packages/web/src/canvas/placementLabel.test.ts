import { describe, expect, it } from "vitest";
import type { Placement } from "@rastoplan/core";
import { placementLabel } from "./placementLabel.js";

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: "pl1",
    edgeId: "edge:w1",
    wallId: "w1",
    pourId: "p1",
    side: "faceA",
    faceIsInterior: true,
    kind: "panel",
    panelType: "R75",
    offsetAlongEdge: 0,
    width: 75,
    source: "auto",
    flags: [],
    ...overrides,
  };
}

describe("placementLabel", () => {
  it("strips a leading R from a plain straight-panel id for display", () => {
    expect(placementLabel(placement({ panelType: "R75" }))).toBe("75");
    expect(placementLabel(placement({ panelType: "R40", width: 40 }))).toBe("40");
  });

  it("falls back to the rounded width when panelType is empty", () => {
    expect(placementLabel(placement({ panelType: "", width: 42.4 }))).toBe("42");
  });

  it("never strips R inside the inventory-shortage diagnostic", () => {
    expect(
      placementLabel(placement({ panelType: "R40", flags: ["inventory-shortage"] }))
    ).toBe("חסר R40");
  });

  it("never touches the timber-filler label", () => {
    expect(placementLabel(placement({ kind: "timber", panelType: "", width: 7 }))).toBe("עץ 7");
  });

  it("never touches the outer-corner-protrusion label", () => {
    expect(
      placementLabel(placement({ flags: ["outer-corner-protrusion"], width: 8 }))
    ).toBe("+8");
  });

  it("leaves corner-panel ids unchanged even though they don't start with R", () => {
    expect(placementLabel(placement({ kind: "corner-panel", panelType: "C30x30" }))).toBe(
      "C30x30"
    );
  });

  it("does not strip R when a corner id happens to start with R (defensive)", () => {
    expect(
      placementLabel(placement({ kind: "corner-panel", panelType: "R30x30" }))
    ).toBe("R30x30");
  });

  it("respects stripLeadingR: false for callers that want the raw id", () => {
    expect(placementLabel(placement({ panelType: "R75" }), { stripLeadingR: false })).toBe(
      "R75"
    );
  });

  it("never mutates the original panelType field", () => {
    const p = placement({ panelType: "R75" });
    placementLabel(p);
    expect(p.panelType).toBe("R75");
  });
});
