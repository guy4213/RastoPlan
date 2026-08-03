import { describe, expect, it } from "vitest";
import type { Point, Wall } from "../../types.js";
import { DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { buildGraph } from "../buildGraph.js";
import { classifyNodes } from "../classifyNodes.js";
import { classifyCornerSides } from "../classifyCornerSides.js";
import { computeClearLengths } from "../computeClearLengths.js";
import { rectangleWalls, tJunctionWalls } from "./fixtures.js";

const cornerPanelWidth = DEFAULT_PANEL_CATALOG.panels.find((p) => p.type === "C30x30")!.width;

function wallLength(wall: Wall): number {
  const [a, b]: [Point, Point] = wall.innerLine;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("computeClearLengths", () => {
  it("deducts the neighboring wall's thickness once per outer corner, with no double counting", () => {
    const walls = rectangleWalls();
    const { nodes, edges } = buildGraph(walls);
    const classifiedNodes = classifyCornerSides(classifyNodes(nodes, edges), edges);
    const result = computeClearLengths(classifiedNodes, edges, walls, { cornerPanelWidth });

    for (const wall of walls) {
      const edge = result.find((e) => e.wallId === wall.id)!;
      // Every wall here is 20cm thick and both ends are convex ('outer')
      // corners, so each end deducts the neighbor's 20cm thickness once.
      expect(edge.clearLength).toBeCloseTo(wallLength(wall) - 40, 5);
      expect(edge.flags).toHaveLength(0);
    }
  });

  it("flags edges touching a T junction as unresolved instead of guessing a deduction", () => {
    const walls = tJunctionWalls();
    const { nodes, edges } = buildGraph(walls);
    const classifiedNodes = classifyCornerSides(classifyNodes(nodes, edges), edges);
    const result = computeClearLengths(classifiedNodes, edges, walls, { cornerPanelWidth });

    for (const edge of result) {
      const wall = walls.find((w) => w.id === edge.wallId)!;
      expect(edge.flags).toContain("unresolved-T");
      // The far end of each wall here is an open 'end' node, so nothing is
      // deducted and the geometric length passes through unchanged.
      expect(edge.clearLength).toBeCloseTo(wallLength(wall), 5);
    }
  });
});
