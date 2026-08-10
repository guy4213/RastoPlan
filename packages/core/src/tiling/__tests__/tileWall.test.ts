import { describe, expect, it } from "vitest";
import type { Edge, PanelCatalog } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { tileWall, type TileWallTarget } from "../tileWall.js";

function edge(clearLength: number): Edge {
  return { id: "edge:1", wallId: "wall:1", nodeA: "n0", nodeB: "n1", clearLength, flags: [] };
}

const target = (clearLength: number, startOffset = 0): TileWallTarget => ({
  wallId: "wall:1",
  pourId: "pour-1",
  side: "faceA",
  faceIsInterior: true,
  clearLength,
  startOffset,
});

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
  it("customer verification case: 340cm wall -> R75,R75,R40,R75,R75, no timber, all face-A/auto", () => {
    const placements = tileWall(edge(340), target(340), DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);

    expect(placements.map((p) => p.panelType)).toEqual(["R75", "R75", "R40", "R75", "R75"]);
    expect(placements.map((p) => p.width)).toEqual([75, 75, 40, 75, 75]);
    expect(placements.map((p) => p.offsetAlongEdge)).toEqual([0, 75, 150, 190, 265]);
    expect(placements.every((p) => p.side === "faceA")).toBe(true);
    expect(placements.every((p) => p.source === "auto")).toBe(true);
    expect(placements.every((p) => p.kind === "panel")).toBe(true);
    expect(placements.every((p) => p.pourId === "pour-1")).toBe(true);
    expect(placements.every((p) => p.edgeId === "edge:1")).toBe(true);
  });

  it("tiles a wall drawn slightly off-axis instead of declaring it untileable", () => {
    // A hand-drawn wall is almost never an exact whole number of cm. Before
    // rounding, every such wall matched no combination at all and came back as
    // a single full-length timber filler.
    const placements = tileWall(
      edge(340),
      target(340.0416305603426),
      DEFAULT_PANEL_CATALOG,
      DEFAULT_ACCESSORY_RULES
    );

    expect(placements.map((p) => p.panelType)).toEqual(["R75", "R75", "R40", "R75", "R75"]);
    expect(placements.some((p) => p.flags.includes("gap-out-of-range"))).toBe(false);
  });

  it("lays an outer face out from its own negative start offset", () => {
    // The outer face begins before the drawn line does, by the neighbouring
    // wall's thickness at the corner it wraps.
    const placements = tileWall(
      edge(340),
      { ...target(340, -20), side: "faceB", faceIsInterior: false },
      DEFAULT_PANEL_CATALOG,
      DEFAULT_ACCESSORY_RULES
    );

    expect(placements.map((p) => p.offsetAlongEdge)).toEqual([-20, 55, 130, 170, 245]);
    expect(placements.every((p) => p.side === "faceB")).toBe(true);
  });

  it("no valid combination: returns one flagged placement spanning the whole edge instead of crashing", () => {
    const placements = tileWall(edge(42), target(42), sparseCatalog(), DEFAULT_ACCESSORY_RULES);

    expect(placements).toHaveLength(1);
    expect(placements[0]?.flags).toEqual(["gap-out-of-range"]);
    expect(placements[0]?.width).toBe(42);
  });
});
