import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { buildGraph } from "../../geometry/buildGraph.js";
import { classifyNodes } from "../../geometry/classifyNodes.js";
import { classifyCornerSides } from "../../geometry/classifyCornerSides.js";
import {
  lShapeWalls,
  rectangleWalls,
  rectangleWallsMixedThickness,
} from "../../geometry/__tests__/fixtures.js";
import { placeCornerPanels } from "../placeCornerPanels.js";

function prep(walls: Wall[], rules = DEFAULT_ACCESSORY_RULES) {
  const { nodes, edges } = buildGraph(walls);
  const classified = classifyCornerSides(classifyNodes(nodes, edges), edges);
  return placeCornerPanels(classified, edges, walls, DEFAULT_PANEL_CATALOG, rules);
}

/** One physical corner panel is emitted once per meeting wall; count the units. */
function cornerUnits(placements: { groupId?: string }[]): number {
  return new Set(placements.map((p) => p.groupId)).size;
}

describe("placeCornerPanels — a corner panel at EVERY corner", () => {
  it("a box gets four C30x30 units — convex corners are not an exception", () => {
    const result = prep(rectangleWalls());

    // 4 corners × 2 meeting walls = 8 legs, but only 4 physical panels.
    expect(result.innerCornerPanels).toHaveLength(8);
    expect(cornerUnits(result.innerCornerPanels)).toBe(4);
    expect(result.innerCornerPanels.every((p) => p.panelType === "C30x30")).toBe(true);
    expect(result.innerCornerPanels.every((p) => p.kind === "corner-panel")).toBe(true);
  });

  it("keeps corner panels on the INNER face only — outside, straight panels overlap instead", () => {
    const result = prep(rectangleWalls());
    expect(result.innerCornerPanels.every((p) => p.side === "inner")).toBe(true);
  });

  it("both legs of one corner share a groupId so they price as one panel", () => {
    const result = prep(rectangleWalls());
    const byGroup = new Map<string, number>();
    for (const p of result.innerCornerPanels) {
      byGroup.set(p.groupId!, (byGroup.get(p.groupId!) ?? 0) + 1);
    }
    expect([...byGroup.values()]).toEqual([2, 2, 2, 2]);
  });

  it("deducts one corner-panel leg from each end: a 400cm wall runs 340cm clear", () => {
    const result = prep(rectangleWalls());
    for (const edge of result.edges) {
      // 400 - 30 - 30 and 300 - 30 - 30. The 340 is the spec's canonical
      // middle-rule run (340 -> 4x75 + 40), which is a good sanity check.
      const expected = edge.wallId === "bottom" || edge.wallId === "top" ? 340 : 240;
      expect(edge.clearLength).toBe(expected);
      expect(edge.flags).toHaveLength(0);
    }
  });

  it("L-shape: all six corners get a panel, the concave notch included", () => {
    const result = prep(lShapeWalls());
    expect(cornerUnits(result.innerCornerPanels)).toBe(6);

    // The notch at (200,150) is where w3 ends and w4 starts.
    const w3 = result.innerCornerPanels.filter((p) => p.edgeId === "edge:w3");
    const w4 = result.innerCornerPanels.filter((p) => p.edgeId === "edge:w4");
    expect(w3).toHaveLength(2);
    expect(w4).toHaveLength(2);
    // They share the notch node, so one leg of each belongs to the same panel.
    const shared = w3.filter((a) => w4.some((b) => b.groupId === a.groupId));
    expect(shared).toHaveLength(1);
  });

  it("picks the leading corner panel, not whichever size sorts first in the catalog", () => {
    const result = prep(rectangleWalls());
    // The catalog also stocks C15x15/C20x20/C25x25 ahead of C30x30.
    expect(result.innerCornerPanels.every((p) => p.width === 30)).toBe(true);
  });
});

describe("placeCornerPanels — outer (convex) corner overlap", () => {
  it("emits one overlap strip per (edge, convex-corner end) — 8 on a box", () => {
    const result = prep(rectangleWalls());
    expect(result.outerCornerProtrusions).toHaveLength(8);
    for (const p of result.outerCornerProtrusions) {
      expect(p.side).toBe("outer");
      expect(p.flags).toContain("outer-corner-protrusion");
      // Straight panel overlapping, never a corner panel.
      expect(p.kind).not.toBe("corner-panel");
    }
  });

  it("is 10cm when every wall is the reference 20cm thick", () => {
    const result = prep(rectangleWalls());
    for (const p of result.outerCornerProtrusions) {
      expect(p.width).toBe(DEFAULT_ACCESSORY_RULES.outerCornerProtrusionCm);
    }
  });

  it("emits nothing at the concave notch of an L — only the 5 convex corners", () => {
    const result = prep(lShapeWalls());
    // 5 convex L nodes × 2 walls each = 10.
    expect(result.outerCornerProtrusions).toHaveLength(10);
    const w3Protrusions = result.outerCornerProtrusions.filter((p) => p.edgeId === "edge:w3");
    expect(w3Protrusions.every((p) => !p.id.endsWith(":protrusion:B"))).toBe(true);
  });

  it("honors a custom outerCornerProtrusionCm from the rules", () => {
    const result = prep(rectangleWalls(), {
      ...DEFAULT_ACCESSORY_RULES,
      outerCornerProtrusionCm: 15,
    });
    for (const p of result.outerCornerProtrusions) expect(p.width).toBe(15);
  });
});

describe("placeCornerPanels — the customer's mixed-thickness model", () => {
  it("bottom wall 30cm, rest 20cm: the overlap follows the NEIGHBOUR's thickness", () => {
    const result = prep(rectangleWallsMixedThickness());
    const widthAt = (edgeId: string, end: "A" | "B") =>
      result.outerCornerProtrusions.find((p) => p.id === `placement:${edgeId}:protrusion:${end}`)
        ?.width;

    // The bottom wall's own neighbours are `left` and `right`, both 20cm →
    // it keeps the standard 10cm at both ends.
    expect(widthAt("edge:bottom", "A")).toBe(10);
    expect(widthAt("edge:bottom", "B")).toBe(10);

    // `right` starts at the bottom-right corner, where its neighbour is the
    // 30cm bottom wall → that end drops to 5cm; its far end still sees 20cm.
    expect(widthAt("edge:right", "A")).toBe(5);
    expect(widthAt("edge:right", "B")).toBe(10);

    // `left` ends at the bottom-left corner — mirror image of `right`.
    expect(widthAt("edge:left", "A")).toBe(10);
    expect(widthAt("edge:left", "B")).toBe(5);

    // `top` never touches the thick wall.
    expect(widthAt("edge:top", "A")).toBe(10);
    expect(widthAt("edge:top", "B")).toBe(10);
  });

  it("exactly two of the eight strips are reduced — the ones meeting the thick wall", () => {
    const result = prep(rectangleWallsMixedThickness());
    const widths = result.outerCornerProtrusions.map((p) => p.width).sort((a, b) => a - b);
    expect(widths).toEqual([5, 5, 10, 10, 10, 10, 10, 10]);
  });

  it("wall thickness does not change the clear run — only the overlap", () => {
    const uniform = prep(rectangleWalls());
    const mixed = prep(rectangleWallsMixedThickness());
    const lengths = (r: typeof uniform) => r.edges.map((e) => e.clearLength);
    expect(lengths(mixed)).toEqual(lengths(uniform));
  });
});
