import { describe, expect, it } from "vitest";
import type { Placement } from "../../types.js";
import { rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { tileProject } from "../../corners/tileProject.js";
import { countPanels } from "../countPanels.js";
import { projectOf } from "./fixtures.js";

function synthetic(overrides: Partial<Placement>): Placement {
  return {
    id: "p",
    edgeId: "e",
    pourId: "pour-1",
    side: "inner",
    kind: "panel",
    panelType: "R75",
    offsetAlongEdge: 0,
    width: 75,
    source: "auto",
    flags: [],
    ...overrides,
  };
}

describe("countPanels", () => {
  it("groups by panelType across both inner and outer sides (each is a distinct physical panel)", () => {
    const placements = tileProject(projectOf(rectangleWalls()));
    const panels = countPanels(placements);
    // The auto-tile picks whichever combo the priority order surfaces; the
    // stable invariant is that inner + outer count together, so every type
    // count is even.
    for (const [, n] of Object.entries(panels.byType)) {
      expect(n % 2).toBe(0);
    }
    // R75 is leading and heavily used at these lengths; at least some
    // must be present.
    expect(panels.byType.R75 ?? 0).toBeGreaterThan(0);
  });

  it("excludes outer-corner-protrusion markers from the panel count (they're overhangs, not distinct panels)", () => {
    const placements = tileProject(projectOf(rectangleWalls()));
    const withProtrusions = countPanels(placements);
    const strippedProtrusions = countPanels(
      placements.filter((p) => !p.flags.includes("outer-corner-protrusion"))
    );
    expect(withProtrusions).toEqual(strippedProtrusions);
  });

  it("sums timber pieces AND total timber length in cm", () => {
    const placements: Placement[] = [
      synthetic({ id: "t1", kind: "timber", panelType: "", width: 7 }),
      synthetic({ id: "t2", kind: "timber", panelType: "", width: 8, side: "outer" }),
      synthetic({ id: "r1", panelType: "R60", width: 60 }),
    ];
    const panels = countPanels(placements);
    expect(panels.timberPieces).toBe(2);
    expect(panels.timberLengthCm).toBe(15);
    expect(panels.byType.R60).toBe(1);
  });

  it("returns empty structure for an empty placement list", () => {
    expect(countPanels([])).toEqual({ byType: {}, timberPieces: 0, timberLengthCm: 0 });
  });
});
