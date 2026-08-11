import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { resolveWalls } from "../../contours/resolveWalls.js";
import {
  collinearSplitWallWalls,
  lShapeWalls,
  lShapedPartitionWalls,
  rectangleWalls,
  rectangleWallsMixedThickness,
  roomWithInteriorWallWalls,
} from "../../geometry/__tests__/fixtures.js";
import { placeCornerPanels } from "../placeCornerPanels.js";

function prep(walls: Wall[], rules = DEFAULT_ACCESSORY_RULES) {
  return placeCornerPanels({
    resolution: resolveWalls(walls),
    walls,
    catalog: DEFAULT_PANEL_CATALOG,
    rules,
  });
}

/** One physical corner panel is emitted once per meeting wall; count the units. */
function cornerUnits(placements: { groupId?: string }[]): number {
  return new Set(placements.map((p) => p.groupId)).size;
}

describe("placeCornerPanels — a corner panel at EVERY corner", () => {
  it("a box gets four C30x30 units — convex corners are not an exception", () => {
    const result = prep(rectangleWalls());

    // 4 corners × 2 meeting walls = 8 legs, but only 4 physical panels.
    expect(result.cornerPanels).toHaveLength(8);
    expect(cornerUnits(result.cornerPanels)).toBe(4);
    expect(result.cornerPanels.every((p) => p.panelType === "C30x30")).toBe(true);
    expect(result.cornerPanels.every((p) => p.kind === "corner-panel")).toBe(true);
  });

  it("keeps corner panels on the room-facing face — outside, straight panels overlap instead", () => {
    const result = prep(rectangleWalls());

    expect(result.cornerPanels.every((p) => p.side === "faceA")).toBe(true);
    expect(result.cornerPanels.every((p) => p.faceIsInterior)).toBe(true);
  });

  it("both legs of one corner share a groupId so they price as one panel", () => {
    const result = prep(rectangleWalls());
    const byGroup = new Map<string, number>();
    for (const p of result.cornerPanels) {
      byGroup.set(p.groupId!, (byGroup.get(p.groupId!) ?? 0) + 1);
    }
    expect([...byGroup.values()]).toEqual([2, 2, 2, 2]);
  });

  it("deducts one corner-panel leg from each end: a 400cm wall runs 340cm clear", () => {
    const result = prep(rectangleWalls());
    for (const edge of result.edges) {
      // 400 - 30 - 30 and 300 - 30 - 30. The 340 is the spec's canonical
      // middle-rule run (340 -> 4x75 + 40).
      const expected = edge.wallId === "bottom" || edge.wallId === "top" ? 340 : 240;
      expect(edge.clearLength).toBe(expected);
      expect(edge.flags).toHaveLength(0);
    }
  });

  it("leaves no hole at the ends: leg + run + leg covers the wall exactly", () => {
    const result = prep(rectangleWalls());
    const bottom = [
      ...result.cornerPanels.filter((p) => p.edgeId === "edge:bottom"),
    ].sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);
    const run = result.runs.get("edge:bottom")!.faceA;

    // The near leg fills [0,30], the run takes [30,370], the far leg [370,400].
    expect(bottom[0]!.offsetAlongEdge).toBe(0);
    expect(run.startOffset).toBe(30);
    expect(run.startOffset + run.clearLength).toBe(370);
    expect(bottom[1]!.offsetAlongEdge).toBe(370);
    expect(bottom[1]!.offsetAlongEdge + bottom[1]!.width).toBe(400);
  });

  it("L-shape: all six corners get a panel, the concave notch included", () => {
    const result = prep(lShapeWalls());
    expect(cornerUnits(result.cornerPanels)).toBe(6);

    // The notch at (200,150) is where w3 ends and w4 starts.
    const w3 = result.cornerPanels.filter((p) => p.edgeId === "edge:w3");
    const w4 = result.cornerPanels.filter((p) => p.edgeId === "edge:w4");
    expect(w3).toHaveLength(2);
    expect(w4).toHaveLength(2);
    // They share the notch node, so one leg of each belongs to the same panel.
    const shared = w3.filter((a) => w4.some((b) => b.groupId === a.groupId));
    expect(shared).toHaveLength(1);
  });

  it("picks the leading corner panel, not whichever size sorts first in the catalog", () => {
    const result = prep(rectangleWalls());
    // The catalog also stocks C15x15/C20x20/C25x25 ahead of C30x30.
    expect(result.cornerPanels.every((p) => p.width === 30)).toBe(true);
  });
});

describe("placeCornerPanels — straight joins are not corners", () => {
  it("emits nothing where one wall was drawn as two collinear segments", () => {
    const result = prep(collinearSplitWallWalls());

    expect(cornerUnits(result.cornerPanels)).toBe(4);
    expect(result.cornerPanels).toHaveLength(8);
    expect(result.cornerPanels.some((p) => p.id.includes("bottom-left:corner:B"))).toBe(false);
  });

  it("leaves the full run tileable across the join: 170 + 170 = the unsplit 340", () => {
    const split = prep(collinearSplitWallWalls());
    const byWall = new Map(split.edges.map((e) => [e.wallId, e.clearLength]));

    expect(byWall.get("bottom-left")! + byWall.get("bottom-right")!).toBe(340);
    expect(split.edges.find((e) => e.wallId === "bottom-left")!.flags).toContain("straight-join");
  });
});

describe("placeCornerPanels — a wall with a room on both sides", () => {
  it("gives each room its own corner panel and no overlap strip anywhere on the partition", () => {
    const result = prep(roomWithInteriorWallWalls());

    const partitionCorners = result.cornerPanels.filter((p) => p.edgeId === "edge:partition");
    expect(partitionCorners).toHaveLength(0);

    const partitionProtrusions = result.protrusions.filter((p) => p.edgeId === "edge:partition");
    expect(partitionProtrusions).toHaveLength(0);
  });

  it("still places a panel at each of the four box corners", () => {
    const result = prep(roomWithInteriorWallWalls());
    expect(cornerUnits(result.cornerPanels)).toBe(4);
  });

  it("gives a partition's own corner one panel per room, on the face that serves it", () => {
    const result = prep(lShapedPartitionWalls());
    const atTheBend = result.cornerPanels.filter(
      (p) => p.edgeId === "edge:q1" || p.edgeId === "edge:q2"
    );

    // One physical corner, two rooms → two corner panels, four legs.
    expect(atTheBend).toHaveLength(4);
    expect(cornerUnits(atTheBend)).toBe(2);
    expect(new Set(atTheBend.map((p) => p.side))).toEqual(new Set(["faceA", "faceB"]));
    expect(atTheBend.every((p) => p.faceIsInterior)).toBe(true);
  });

  it("emits no overlap strip at a corner whose convex side is another room", () => {
    const result = prep(lShapedPartitionWalls());

    expect(
      result.protrusions.filter((p) => p.edgeId === "edge:q1" || p.edgeId === "edge:q2")
    ).toHaveLength(0);
  });

  it("counts the partition bend on top of the four box corners", () => {
    expect(cornerUnits(prep(lShapedPartitionWalls()).cornerPanels)).toBe(6);
  });
});

describe("placeCornerPanels — outer (convex) corner overlap", () => {
  it("emits one overlap strip per (edge, convex-corner end) — 8 on a box", () => {
    const result = prep(rectangleWalls());
    expect(result.protrusions).toHaveLength(8);
    for (const p of result.protrusions) {
      expect(p.side).toBe("faceB");
      expect(p.faceIsInterior).toBe(false);
      expect(p.flags).toContain("outer-corner-protrusion");
      // Straight panel overlapping, never a corner panel.
      expect(p.kind).not.toBe("corner-panel");
    }
  });

  it("is 10cm when every wall is the reference 20cm thick", () => {
    const result = prep(rectangleWalls());
    for (const p of result.protrusions) {
      expect(p.width).toBe(DEFAULT_ACCESSORY_RULES.outerCornerProtrusionCm);
    }
  });

  it("emits nothing at the concave notch of an L — only the 5 convex corners", () => {
    const result = prep(lShapeWalls());
    // 5 convex L nodes × 2 walls each = 10.
    expect(result.protrusions).toHaveLength(10);
    const w3Protrusions = result.protrusions.filter((p) => p.edgeId === "edge:w3");
    expect(w3Protrusions.every((p) => !p.id.endsWith(":protrusion:B"))).toBe(true);
  });

  it("honors a custom outerCornerProtrusionCm from the rules", () => {
    const result = prep(rectangleWalls(), {
      ...DEFAULT_ACCESSORY_RULES,
      outerCornerProtrusionCm: 15,
    });
    for (const p of result.protrusions) expect(p.width).toBe(15);
  });
});

describe("placeCornerPanels — the customer's mixed-thickness model", () => {
  it("bottom wall 30cm, rest 20cm: the overlap follows the NEIGHBOUR's thickness", () => {
    const result = prep(rectangleWallsMixedThickness());
    const widthAt = (edgeId: string, end: "A" | "B") =>
      result.protrusions.find((p) => p.id === `placement:${edgeId}:protrusion:${end}`)?.width;

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
    const widths = result.protrusions.map((p) => p.width).sort((a, b) => a - b);
    expect(widths).toEqual([5, 5, 10, 10, 10, 10, 10, 10]);
  });

  it("wall thickness does not change the clear run — only the overlap", () => {
    const uniform = prep(rectangleWalls());
    const mixed = prep(rectangleWallsMixedThickness());
    const lengths = (r: typeof uniform) => r.edges.map((e) => e.clearLength);
    expect(lengths(mixed)).toEqual(lengths(uniform));
  });
});
