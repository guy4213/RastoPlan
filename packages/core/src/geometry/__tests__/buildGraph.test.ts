import { describe, expect, it } from "vitest";
import { buildGraph } from "../buildGraph.js";
import { classifyNodes } from "../classifyNodes.js";
import { rectangleWalls, rectangleWallsWithJitter } from "./fixtures.js";

describe("buildGraph", () => {
  it("builds one edge per wall and unifies exactly-coincident corners into shared nodes", () => {
    const walls = rectangleWalls();
    const { nodes, edges } = buildGraph(walls);

    expect(edges).toHaveLength(4);
    expect(nodes).toHaveLength(4);
    expect(classifyNodes(nodes, edges).every((n) => n.type === "L")).toBe(true);
  });

  it("snaps corners that are close but not exactly coincident (within the 2cm tolerance)", () => {
    const { nodes, edges } = buildGraph(rectangleWallsWithJitter());

    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(4);
    expect(classifyNodes(nodes, edges).every((n) => n.type === "L")).toBe(true);
  });

  it("keeps the edge -> wallId relationship", () => {
    const walls = rectangleWalls();
    const { edges } = buildGraph(walls);

    for (const wall of walls) {
      expect(edges.some((e) => e.wallId === wall.id)).toBe(true);
    }
  });
});
