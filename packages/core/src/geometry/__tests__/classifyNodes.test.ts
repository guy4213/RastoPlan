import { describe, expect, it } from "vitest";
import type { Point, Wall } from "../../types.js";
import { buildGraph } from "../buildGraph.js";
import { classifyNodes } from "../classifyNodes.js";
import { collinearSplitWallWalls, rectangleWalls, tJunctionWalls } from "./fixtures.js";

function pairWalls(far: Point): Wall[] {
  return [
    { id: "a", pourId: "pour-1", innerLine: [{ x: 0, y: 0 }, { x: 200, y: 0 }], thickness: 20 },
    { id: "b", pourId: "pour-1", innerLine: [{ x: 200, y: 0 }, far], thickness: 20 },
  ];
}

/** Two walls meeting at (200,0); the second deviates `offStraightDeg` from carrying straight on. */
function bentPairWalls(offStraightDeg: number): Wall[] {
  const radians = (offStraightDeg * Math.PI) / 180;
  return pairWalls({ x: 200 + 200 * Math.cos(radians), y: 200 * Math.sin(radians) });
}

function typeAt(walls: Wall[], point: Point): string | undefined {
  const { nodes, edges } = buildGraph(walls);
  return classifyNodes(nodes, edges).find(
    (n) => Math.abs(n.point.x - point.x) < 1 && Math.abs(n.point.y - point.y) < 1
  )?.type;
}

describe("classifyNodes", () => {
  it("classifies a 3-wall junction as 'T' and the loose wall ends as 'end'", () => {
    const { nodes, edges } = buildGraph(tJunctionWalls());
    const classified = classifyNodes(nodes, edges);

    expect(classified.filter((n) => n.type === "T")).toHaveLength(1);
    expect(classified.filter((n) => n.type === "end")).toHaveLength(3);
  });

  it("classifies a real box corner as 'L'", () => {
    const { nodes, edges } = buildGraph(rectangleWalls());
    expect(classifyNodes(nodes, edges).filter((n) => n.type === "L")).toHaveLength(4);
  });

  it("does not turn a wall split into two collinear halves into a corner", () => {
    expect(typeAt(collinearSplitWallWalls(), { x: 200, y: 0 })).toBe("straight-join");

    const { nodes, edges } = buildGraph(collinearSplitWallWalls());
    expect(classifyNodes(nodes, edges).filter((n) => n.type === "L")).toHaveLength(4);
  });

  it("draws the straight-join line at the configured tolerance", () => {
    expect(typeAt(bentPairWalls(0), { x: 200, y: 0 })).toBe("straight-join");
    expect(typeAt(bentPairWalls(8), { x: 200, y: 0 })).toBe("straight-join");
    expect(typeAt(bentPairWalls(12), { x: 200, y: 0 })).toBe("L");
  });

  it("flags walls that double back on each other instead of calling it a clean corner", () => {
    const { nodes, edges } = buildGraph(pairWalls({ x: 100, y: 5 }));
    const node = classifyNodes(nodes, edges).find((n) => Math.abs(n.point.x - 200) < 1);

    expect(node?.type).toBe("L");
    expect(node?.flags).toContain("degenerate-turn");
  });
});
