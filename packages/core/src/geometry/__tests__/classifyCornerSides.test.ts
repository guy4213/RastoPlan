import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import { buildGraph } from "../buildGraph.js";
import { classifyNodes } from "../classifyNodes.js";
import { classifyCornerSides } from "../classifyCornerSides.js";
import { buildPlanarFaces } from "../planarFaces.js";
import {
  collinearSplitWallWalls,
  lShapeWalls,
  roomWithInteriorWallWalls,
  tJunctionWalls,
} from "./fixtures.js";

function classify(walls: Wall[]) {
  const { nodes, edges } = buildGraph(walls);
  const typed = classifyNodes(nodes, edges);
  return classifyCornerSides(typed, buildPlanarFaces(typed, edges));
}

describe("classifyCornerSides", () => {
  it("identifies the L-shape's single notch as the inner corner, and the other 5 as outer", () => {
    const { nodes } = classify(lShapeWalls());

    const notch = nodes.find(
      (n) => Math.abs(n.point.x - 200) < 1 && Math.abs(n.point.y - 150) < 1
    );
    expect(notch).toBeDefined();
    expect(notch?.cornerSide).toBe("inner");

    const others = nodes.filter((n) => n.id !== notch?.id);
    expect(others).toHaveLength(5);
    for (const node of others) {
      expect(node.cornerSide).toBe("outer");
    }
  });

  it("reports the interior angle of each corner", () => {
    const { corners } = classify(lShapeWalls());

    expect(corners.filter((c) => Math.round(c.interiorAngleDeg) === 90)).toHaveLength(5);
    expect(corners.filter((c) => Math.round(c.interiorAngleDeg) === 270)).toHaveLength(1);
  });

  it("still classifies the box corners when an interior partition creates T junctions", () => {
    const { nodes, corners } = classify(roomWithInteriorWallWalls());

    const boxCorners = nodes.filter((n) => n.type === "L");
    expect(boxCorners).toHaveLength(4);
    for (const node of boxCorners) {
      expect(node.cornerSide).toBe("outer");
      expect(node.flags).not.toContain("unresolved-corner-side");
    }

    expect(corners).toHaveLength(4);
    expect(corners.every((c) => c.side === "outer")).toBe(true);
    expect(nodes.filter((n) => n.type === "T")).toHaveLength(2);
  });

  it("emits no corner at a straight join", () => {
    const { corners } = classify(collinearSplitWallWalls());

    expect(corners).toHaveLength(4);
    expect(corners.some((c) => c.nodeId === nodeIdAt(collinearSplitWallWalls(), 200, 0))).toBe(
      false
    );
  });

  it("flags an unresolvable corner instead of silently calling it inner", () => {
    // An open chain: two walls meeting at a corner that bounds no enclosed room.
    const walls: Wall[] = [
      { id: "a", pourId: "p", innerLine: [{ x: 0, y: 0 }, { x: 200, y: 0 }], thickness: 20 },
      { id: "b", pourId: "p", innerLine: [{ x: 200, y: 0 }, { x: 200, y: 200 }], thickness: 20 },
    ];
    const { nodes, corners } = classify(walls);

    const corner = nodes.find((n) => n.type === "L");
    expect(corner?.cornerSide).toBeUndefined();
    expect(corner?.flags).toContain("unresolved-corner-side");
    expect(corners).toHaveLength(0);
  });

  it("produces nothing at all for a wall tree with no enclosed area", () => {
    expect(classify(tJunctionWalls()).corners).toHaveLength(0);
  });
});

function nodeIdAt(walls: Wall[], x: number, y: number): string | undefined {
  const { nodes } = buildGraph(walls);
  return nodes.find((n) => Math.abs(n.point.x - x) < 1 && Math.abs(n.point.y - y) < 1)?.id;
}
