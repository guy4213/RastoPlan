import { describe, expect, it } from "vitest";
import type { Edge, PanelCatalog } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { tileWall } from "../tileWall.js";

function edge(clearLength: number): Edge {
  return { id: "edge:1", wallId: "wall:1", nodeA: "n0", nodeB: "n1", clearLength, flags: [] };
}

/** Sparse stock list — the full catalog can fill 42cm, so it can't exercise the failure path. */
function sparseCatalog(): PanelCatalog {
  return {
    panels: [75, 60, 55, 50, 40].map((width) => ({
      type: `R${width}`,
      width,
      height: 300,
      isLeading: width === 75,
      inStock: true,
      kind: "straight" as const,
      bomLabel: `פנאל ${width}/300`,
    })),
  };
}

describe("tileWall", () => {
  it("customer verification case: 340cm wall -> R75,R75,R40,R75,R75, no timber, all inner/auto", () => {
    const placements = tileWall(edge(340), "pour-1", DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);

    expect(placements.map((p) => p.panelType)).toEqual(["R75", "R75", "R40", "R75", "R75"]);
    expect(placements.map((p) => p.width)).toEqual([75, 75, 40, 75, 75]);
    expect(placements.map((p) => p.offsetAlongEdge)).toEqual([0, 75, 150, 190, 265]);
    expect(placements.every((p) => p.side === "inner")).toBe(true);
    expect(placements.every((p) => p.source === "auto")).toBe(true);
    expect(placements.every((p) => p.kind === "panel")).toBe(true);
    expect(placements.every((p) => p.pourId === "pour-1")).toBe(true);
    expect(placements.every((p) => p.edgeId === "edge:1")).toBe(true);
  });

  it("no valid combination: returns one flagged placement spanning the whole edge instead of crashing", () => {
    const placements = tileWall(edge(42), "pour-1", sparseCatalog(), DEFAULT_ACCESSORY_RULES);

    expect(placements).toHaveLength(1);
    expect(placements[0]?.flags).toEqual(["gap-out-of-range"]);
    expect(placements[0]?.width).toBe(42);
  });
});
