import { describe, expect, it } from "vitest";
import type { Edge, Placement, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { buildGraph } from "../../geometry/buildGraph.js";
import { classifyNodes } from "../../geometry/classifyNodes.js";
import { classifyCornerSides } from "../../geometry/classifyCornerSides.js";
import { lShapeWalls, rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { placeCornerPanels } from "../../corners/placeCornerPanels.js";
import { tileProject } from "../../corners/tileProject.js";
import { countAccessories, countStraightJoints } from "../countAccessories.js";
import { countPanels } from "../countPanels.js";
import { projectOf } from "./fixtures.js";

function buildGraphContext(walls: Wall[]): {
  edges: Edge[];
  walls: Wall[];
  placements: Placement[];
} {
  const { nodes, edges } = buildGraph(walls);
  const classified = classifyCornerSides(classifyNodes(nodes, edges), edges);
  const corners = placeCornerPanels(
    classified,
    edges,
    walls,
    DEFAULT_PANEL_CATALOG,
    DEFAULT_ACCESSORY_RULES
  );
  const placements = tileProject(projectOf(walls));
  return { edges: corners.edges, walls, placements };
}

describe("countAccessories — rectangular room, manual verification", () => {
  it("matches hand-counted totals for a 400×300 box (thickness 20)", () => {
    const ctx = buildGraphContext(rectangleWalls());
    const count = countAccessories(ctx.placements, ctx.edges, ctx.walls, DEFAULT_ACCESSORY_RULES);

    // 4 corners, each with one corner panel × 3 K30 clamps.
    expect(count.cornerClamps).toBe(12);
    // Struts (inner only): each 400 wall runs 340 clear, each 300 wall 240.
    // ceil(340/150)+ceil(240/150)+ceil(340/150)+ceil(240/150) = 3+2+3+2.
    expect(count.struts).toBe(10);
    // Fixed per project regardless of size.
    expect(count.craneAdapters).toBe(2);
    // Rods and nuts stay in lock-step with the tie points.
    const joints = countStraightJoints(ctx.placements);
    expect(count.dywidagRods).toBe(joints * DEFAULT_ACCESSORY_RULES.dywidagPerRod);
    expect(count.nuts).toBe(count.dywidagRods * DEFAULT_ACCESSORY_RULES.nutsPerDywidag);
  });
});

describe("countAccessories — the customer's clamp formulas", () => {
  it("a box has FOUR C30x30 units — one per corner, not zero and not one per leg", () => {
    const ctx = buildGraphContext(rectangleWalls());
    const panels = countPanels(ctx.placements);

    // The corner panel wraps the corner and is emitted once per meeting
    // wall, but it is one physical panel. This is the number that has to
    // line up with the customer's BOM (בית שמש יציקה 2: 4 × פנאל 30/30/300).
    expect(panels.byType.C30x30).toBe(4);
  });

  it("K30 corner clamps = corner-panel units × 3 (the sheet's =F27*3)", () => {
    const ctx = buildGraphContext(rectangleWalls());
    const count = countAccessories(ctx.placements, ctx.edges, ctx.walls, DEFAULT_ACCESSORY_RULES);
    const cornerUnits = countPanels(ctx.placements).byType.C30x30 ?? 0;

    expect(cornerUnits).toBe(4);
    expect(count.cornerClamps).toBe(cornerUnits * 3);
    expect(count.cornerClamps).toBe(12);
  });

  it("K10 straight clamps = (all panels − corner panels) × 3 (the sheet's =((SUM(...))-4)*3)", () => {
    const ctx = buildGraphContext(rectangleWalls());
    const count = countAccessories(ctx.placements, ctx.edges, ctx.walls, DEFAULT_ACCESSORY_RULES);

    const panels = countPanels(ctx.placements);
    const allUnits = Object.values(panels.byType).reduce((a, b) => a + b, 0);
    const cornerUnits = panels.byType.C30x30 ?? 0;

    expect(count.straightClamps).toBe((allUnits - cornerUnits) * 3);
  });

  it("L-shape: every one of the 6 corners gets a corner panel, convex ones included", () => {
    const ctx = buildGraphContext(lShapeWalls());
    const count = countAccessories(ctx.placements, ctx.edges, ctx.walls, DEFAULT_ACCESSORY_RULES);

    // 5 convex + 1 concave — the distinction no longer decides whether a
    // corner panel exists, only where the outer overlap goes.
    expect(countPanels(ctx.placements).byType.C30x30).toBe(6);
    expect(count.cornerClamps).toBe(18);
  });
});

describe("countAccessories — struts", () => {
  it("counts inner side ONLY — outer-face placements never inflate the strut count", () => {
    const ctx = buildGraphContext(rectangleWalls());

    const outerCount = ctx.placements.filter((p) => p.side === "outer").length;
    expect(outerCount).toBeGreaterThan(0);

    const withPlacements = countAccessories(
      ctx.placements,
      ctx.edges,
      ctx.walls,
      DEFAULT_ACCESSORY_RULES
    );
    // Struts read only from `edges`, not `placements` — dropping every
    // outer-face placement mustn't change the number.
    const innerOnly = ctx.placements.filter((p) => p.side === "inner");
    const withoutOuter = countAccessories(innerOnly, ctx.edges, ctx.walls, DEFAULT_ACCESSORY_RULES);
    expect(withoutOuter.struts).toBe(withPlacements.struts);
  });

  it("rounds up (ceil) — 310cm at 150cm spacing gives 3 struts, not 2.07", () => {
    const edges: Edge[] = [
      { id: "e1", wallId: "w1", nodeA: "n0", nodeB: "n1", clearLength: 310, flags: [] },
    ];
    const count = countAccessories([], edges, [], DEFAULT_ACCESSORY_RULES);
    expect(count.struts).toBe(3);
  });

  it("does not overcount a 300cm wall (exact multiple → 2 struts)", () => {
    const edges: Edge[] = [
      { id: "e1", wallId: "w1", nodeA: "n0", nodeB: "n1", clearLength: 300, flags: [] },
    ];
    const count = countAccessories([], edges, [], DEFAULT_ACCESSORY_RULES);
    expect(count.struts).toBe(2);
  });

  it("zero-length edge contributes 0 struts", () => {
    const edges: Edge[] = [
      { id: "e1", wallId: "w1", nodeA: "n0", nodeB: "n1", clearLength: 0, flags: [] },
    ];
    const count = countAccessories([], edges, [], DEFAULT_ACCESSORY_RULES);
    expect(count.struts).toBe(0);
  });
});

describe("countAccessories — crane adapters", () => {
  it("stays constant at rules.craneAdaptersPerProject regardless of project size", () => {
    const smallRoom: Edge[] = [
      { id: "e1", wallId: "w1", nodeA: "n0", nodeB: "n1", clearLength: 100, flags: [] },
    ];
    const bigRoom: Edge[] = Array.from({ length: 40 }, (_, i) => ({
      id: `e${i}`,
      wallId: `w${i}`,
      nodeA: `n${i}a`,
      nodeB: `n${i}b`,
      clearLength: 1000,
      flags: [],
    }));

    const small = countAccessories([], smallRoom, [], DEFAULT_ACCESSORY_RULES);
    const big = countAccessories([], bigRoom, [], DEFAULT_ACCESSORY_RULES);
    expect(small.craneAdapters).toBe(2);
    expect(big.craneAdapters).toBe(2);
  });

  it("honors a custom craneAdaptersPerProject", () => {
    const count = countAccessories([], [], [], {
      ...DEFAULT_ACCESSORY_RULES,
      craneAdaptersPerProject: 5,
    });
    expect(count.craneAdapters).toBe(5);
  });
});

describe("countAccessories — robustness under manual edit", () => {
  it("reflects a hand-inserted placement (an added panel bumps the clamp count)", () => {
    const ctx = buildGraphContext(rectangleWalls());
    const before = countAccessories(ctx.placements, ctx.edges, ctx.walls, DEFAULT_ACCESSORY_RULES);

    // Find an inner edge and splice a synthetic 20cm panel right after
    // the first straight panel there — creating one extra panel, and one
    // extra panel-to-panel joint that the auto-tile didn't produce.
    const anEdgeId = ctx.placements.find((p) => p.side === "inner" && p.kind === "panel")!.edgeId;
    const edgePlacements = ctx.placements
      .filter((p) => p.edgeId === anEdgeId && p.side === "inner" && p.kind === "panel")
      .sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);
    const first = edgePlacements[0]!;
    const inserted: Placement = {
      id: "manual:1",
      edgeId: anEdgeId,
      pourId: first.pourId,
      side: "inner",
      kind: "panel",
      panelType: "R20",
      offsetAlongEdge: first.offsetAlongEdge + first.width,
      width: 20,
      source: "manual",
      flags: [],
    };
    // Shift everything after by +20 so adjacencies keep matching.
    const shifted = ctx.placements.map((p) => {
      if (p.edgeId !== anEdgeId || p.side !== "inner") return p;
      if (p.offsetAlongEdge < first.offsetAlongEdge + first.width) return p;
      if (p.id === first.id) return p;
      return { ...p, offsetAlongEdge: p.offsetAlongEdge + 20 };
    });

    const edited = [...shifted, inserted];
    const after = countAccessories(edited, ctx.edges, ctx.walls, DEFAULT_ACCESSORY_RULES);

    // One extra straight panel → +clampsPerStraightJoint clamps, and the
    // extra seam it creates brings its rods and nuts with it.
    expect(after.straightClamps - before.straightClamps).toBe(
      DEFAULT_ACCESSORY_RULES.clampsPerStraightJoint
    );
    expect(after.dywidagRods - before.dywidagRods).toBe(DEFAULT_ACCESSORY_RULES.dywidagPerRod);
    expect(after.nuts - before.nuts).toBe(
      DEFAULT_ACCESSORY_RULES.dywidagPerRod * DEFAULT_ACCESSORY_RULES.nutsPerDywidag
    );
    // Struts and corner clamps unaffected — those don't depend on straight panels.
    expect(after.struts).toBe(before.struts);
    expect(after.cornerClamps).toBe(before.cornerClamps);
  });

  it("removing every inner placement zeroes rods/nuts but leaves struts", () => {
    const ctx = buildGraphContext(rectangleWalls());
    const stripped = ctx.placements.filter((p) => p.side !== "inner");
    const count = countAccessories(stripped, ctx.edges, ctx.walls, DEFAULT_ACCESSORY_RULES);

    expect(count.dywidagRods).toBe(0);
    expect(count.nuts).toBe(0);
    // Corner panels are inner-face only, so they go with them.
    expect(count.cornerClamps).toBe(0);
    // Struts still needed on the walls — they read from edges.
    expect(count.struts).toBe(10);
  });
});
