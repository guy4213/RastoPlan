import { describe, expect, it } from "vitest";
import type { Edge, Node, Placement } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { buildGraph } from "../../geometry/buildGraph.js";
import { classifyNodes } from "../../geometry/classifyNodes.js";
import { classifyCornerSides } from "../../geometry/classifyCornerSides.js";
import { rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { placeCornerPanels } from "../../corners/placeCornerPanels.js";
import { tileProject } from "../../corners/tileProject.js";
import { countAccessories, countStraightJoints } from "../countAccessories.js";
import { projectOf } from "./fixtures.js";

function buildGraphContext(walls: ReturnType<typeof rectangleWalls>): {
  nodes: Node[];
  edges: Edge[];
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
  return { nodes: classified, edges: corners.edges, placements };
}

describe("countAccessories — rectangular room, manual verification", () => {
  it("matches hand-counted totals for a 400×300 box (thickness 20)", () => {
    const { nodes, edges, placements } = buildGraphContext(rectangleWalls());
    const count = countAccessories(placements, nodes, edges, DEFAULT_ACCESSORY_RULES);

    // 4 L corners × 3 clamps.
    expect(count.cornerClamps).toBe(12);
    // Struts (inner only): ceil(400/150)+ceil(300/150)+ceil(400/150)+ceil(300/150) = 3+2+3+2.
    expect(count.struts).toBe(10);
    // Fixed per project regardless of size.
    expect(count.craneAdapters).toBe(2);
    // Joints tie together the clamps/rods/nuts trio, so they must stay in lock-step:
    // straightClamps = joints × 3, dywidag = joints × 2, nuts = dywidag × 2.
    const joints = countStraightJoints(placements);
    expect(count.straightClamps).toBe(joints * DEFAULT_ACCESSORY_RULES.clampsPerStraightJoint);
    expect(count.dywidagRods).toBe(joints * DEFAULT_ACCESSORY_RULES.dywidagPerRod);
    expect(count.nuts).toBe(count.dywidagRods * DEFAULT_ACCESSORY_RULES.nutsPerDywidag);
  });
});

describe("countAccessories — struts", () => {
  it("counts inner side ONLY — outer-face placements never inflate the strut count", () => {
    const { nodes, edges, placements } = buildGraphContext(rectangleWalls());

    const outerCount = placements.filter((p) => p.side === "outer").length;
    expect(outerCount).toBeGreaterThan(0);

    const withPlacements = countAccessories(placements, nodes, edges, DEFAULT_ACCESSORY_RULES);
    // Struts read only from `edges`, not `placements` — dropping every
    // outer-face placement mustn't change the number.
    const innerOnly = placements.filter((p) => p.side === "inner");
    const withoutOuter = countAccessories(innerOnly, nodes, edges, DEFAULT_ACCESSORY_RULES);
    expect(withoutOuter.struts).toBe(withPlacements.struts);
  });

  it("rounds up (ceil) — 310cm at 150cm spacing gives 3 struts, not 2.07", () => {
    const edges: Edge[] = [
      { id: "e1", wallId: "w1", nodeA: "n0", nodeB: "n1", clearLength: 310, flags: [] },
    ];
    const count = countAccessories([], [], edges, DEFAULT_ACCESSORY_RULES);
    expect(count.struts).toBe(3);
  });

  it("does not overcount a 300cm wall (exact multiple → 2 struts)", () => {
    const edges: Edge[] = [
      { id: "e1", wallId: "w1", nodeA: "n0", nodeB: "n1", clearLength: 300, flags: [] },
    ];
    const count = countAccessories([], [], edges, DEFAULT_ACCESSORY_RULES);
    expect(count.struts).toBe(2);
  });

  it("zero-length edge contributes 0 struts", () => {
    const edges: Edge[] = [
      { id: "e1", wallId: "w1", nodeA: "n0", nodeB: "n1", clearLength: 0, flags: [] },
    ];
    const count = countAccessories([], [], edges, DEFAULT_ACCESSORY_RULES);
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

    const small = countAccessories([], [], smallRoom, DEFAULT_ACCESSORY_RULES);
    const big = countAccessories([], [], bigRoom, DEFAULT_ACCESSORY_RULES);
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
  it("reflects a hand-inserted placement (added panel-to-panel joint bumps the joint count)", () => {
    const { nodes, edges, placements } = buildGraphContext(rectangleWalls());
    const before = countAccessories(placements, nodes, edges, DEFAULT_ACCESSORY_RULES);

    // Find an inner edge and splice a synthetic 20cm panel right after
    // the first straight panel there — creating one extra panel-to-panel
    // joint that didn't exist in the auto-tile output.
    const anEdgeId = placements.find((p) => p.side === "inner" && p.kind === "panel")!.edgeId;
    const edgePlacements = placements
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
    const shifted = placements.map((p) => {
      if (p.edgeId !== anEdgeId || p.side !== "inner") return p;
      if (p.offsetAlongEdge < first.offsetAlongEdge + first.width) return p;
      if (p.id === first.id) return p;
      return { ...p, offsetAlongEdge: p.offsetAlongEdge + 20 };
    });

    const edited = [...shifted, inserted];
    const after = countAccessories(edited, nodes, edges, DEFAULT_ACCESSORY_RULES);

    // One extra panel-to-panel joint → +1 clampsPerStraightJoint worth of
    // clamps, +dywidagPerRod rods, and the nuts follow the rods.
    expect(after.straightClamps - before.straightClamps).toBe(
      DEFAULT_ACCESSORY_RULES.clampsPerStraightJoint
    );
    expect(after.dywidagRods - before.dywidagRods).toBe(DEFAULT_ACCESSORY_RULES.dywidagPerRod);
    expect(after.nuts - before.nuts).toBe(
      DEFAULT_ACCESSORY_RULES.dywidagPerRod * DEFAULT_ACCESSORY_RULES.nutsPerDywidag
    );
    // Struts and corner clamps unaffected — those don't depend on panel-level placements.
    expect(after.struts).toBe(before.struts);
    expect(after.cornerClamps).toBe(before.cornerClamps);
  });

  it("removing every inner placement zeroes clamps/rods/nuts but leaves corner clamps and struts", () => {
    const { nodes, edges, placements } = buildGraphContext(rectangleWalls());
    const stripped = placements.filter((p) => p.side !== "inner");
    const count = countAccessories(stripped, nodes, edges, DEFAULT_ACCESSORY_RULES);

    expect(count.straightClamps).toBe(0);
    expect(count.dywidagRods).toBe(0);
    expect(count.nuts).toBe(0);
    // Corners still exist as graph nodes; struts still needed on the walls.
    expect(count.cornerClamps).toBe(12);
    expect(count.struts).toBe(10);
  });
});
