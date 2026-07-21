import { describe, expect, it } from "vitest";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { buildGraph } from "../../geometry/buildGraph.js";
import { classifyNodes } from "../../geometry/classifyNodes.js";
import { classifyCornerSides } from "../../geometry/classifyCornerSides.js";
import { lShapeWalls, rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { placeCornerPanels } from "../placeCornerPanels.js";

function prep(walls: ReturnType<typeof rectangleWalls>) {
  const { nodes, edges } = buildGraph(walls);
  const classified = classifyCornerSides(classifyNodes(nodes, edges), edges);
  return placeCornerPanels(classified, edges, walls, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);
}

describe("placeCornerPanels — outer (convex) corners", () => {
  it("emits no corner-panels on a box (all 4 corners are convex/outer)", () => {
    const result = prep(rectangleWalls());
    expect(result.innerCornerPanels).toHaveLength(0);
  });

  it("emits one 10cm outer-face protrusion per (edge, outer-corner end) — 8 total on a 4-corner box", () => {
    const result = prep(rectangleWalls());
    expect(result.outerCornerProtrusions).toHaveLength(8);
    for (const p of result.outerCornerProtrusions) {
      expect(p.side).toBe("outer");
      expect(p.width).toBe(DEFAULT_ACCESSORY_RULES.outerCornerProtrusionCm);
      expect(p.flags).toContain("outer-corner-protrusion");
      // Explicitly NOT a corner panel — the spec's outer-corner rule uses a
      // straight panel that protrudes, never a C30x30-style corner panel.
      expect(p.kind).not.toBe("corner-panel");
    }
  });

  it("does not deduct anything from the clearLength at outer corners (replaces the geometry-layer placeholder)", () => {
    const result = prep(rectangleWalls());
    for (const edge of result.edges) {
      // Bottom+top are 400, left+right are 300 — full geometric length,
      // no neighbor-thickness placeholder applied.
      const expected = edge.wallId === "bottom" || edge.wallId === "top" ? 400 : 300;
      expect(edge.clearLength).toBe(expected);
      expect(edge.flags).toHaveLength(0);
    }
  });

  it("honors a custom outerCornerProtrusionCm from the rules", () => {
    const { nodes, edges } = buildGraph(rectangleWalls());
    const classified = classifyCornerSides(classifyNodes(nodes, edges), edges);
    const result = placeCornerPanels(classified, edges, rectangleWalls(), DEFAULT_PANEL_CATALOG, {
      ...DEFAULT_ACCESSORY_RULES,
      outerCornerProtrusionCm: 15,
    });
    for (const p of result.outerCornerProtrusions) expect(p.width).toBe(15);
  });
});

describe("placeCornerPanels — inner (concave) corner", () => {
  it("places C30x30 on both walls meeting at the L-shape's notch", () => {
    const result = prep(lShapeWalls());

    // The notch is at (200,150). w3 ends at nodeB=(200,150); w4 starts at
    // nodeA=(200,150). So corner panels attach to w3 at its B end and to
    // w4 at its A end — both C30x30, both inner side.
    const w3Corner = result.innerCornerPanels.find((p) => p.edgeId === "edge:w3");
    const w4Corner = result.innerCornerPanels.find((p) => p.edgeId === "edge:w4");
    expect(w3Corner).toBeDefined();
    expect(w4Corner).toBeDefined();
    expect(w3Corner?.panelType).toBe("C30x30");
    expect(w4Corner?.panelType).toBe("C30x30");
    expect(w3Corner?.kind).toBe("corner-panel");
    expect(w4Corner?.kind).toBe("corner-panel");
    expect(w3Corner?.width).toBe(30);
    expect(w4Corner?.width).toBe(30);
  });

  it("deducts exactly one corner-panel width (30cm) from each meeting edge at an inner corner", () => {
    const result = prep(lShapeWalls());
    // w3: raw 200, one inner + one outer → clearLength 170.
    // w4: raw 150, one inner + one outer → clearLength 120.
    const w3 = result.edges.find((e) => e.wallId === "w3")!;
    const w4 = result.edges.find((e) => e.wallId === "w4")!;
    expect(w3.clearLength).toBe(170);
    expect(w4.clearLength).toBe(120);
  });

  it("emits protrusions only at outer corners of the L, not at the notch", () => {
    const result = prep(lShapeWalls());
    // 5 outer L nodes × 2 walls each = 10 protrusion emissions total.
    expect(result.outerCornerProtrusions).toHaveLength(10);
    // The notch (200,150) shouldn't be the anchor of any protrusion.
    // A quick surrogate: on w3 the notch is nodeB; the ':protrusion:B'
    // id would only exist if the notch were classified outer. It isn't.
    const w3Protrusions = result.outerCornerProtrusions.filter((p) => p.edgeId === "edge:w3");
    expect(w3Protrusions.every((p) => !p.id.endsWith(":protrusion:B"))).toBe(true);
  });
});
