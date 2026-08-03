import { describe, expect, it } from "vitest";
import { buildGraph } from "../buildGraph.js";
import { classifyNodes } from "../classifyNodes.js";
import { classifyCornerSides } from "../classifyCornerSides.js";
import { lShapeWalls } from "./fixtures.js";

describe("classifyCornerSides", () => {
  it("identifies the L-shape's single notch as the inner corner, and the other 5 as outer", () => {
    const { nodes, edges } = buildGraph(lShapeWalls());
    const classified = classifyCornerSides(classifyNodes(nodes, edges), edges);

    const notch = classified.find(
      (n) => Math.abs(n.point.x - 200) < 1 && Math.abs(n.point.y - 150) < 1
    );
    expect(notch).toBeDefined();
    expect(notch?.cornerSide).toBe("inner");

    const others = classified.filter((n) => n.id !== notch?.id);
    expect(others).toHaveLength(5);
    for (const node of others) {
      expect(node.cornerSide).toBe("outer");
    }
  });
});
