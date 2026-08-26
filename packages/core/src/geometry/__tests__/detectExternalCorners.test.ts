import { describe, expect, it } from "vitest";
import type { Point, Project, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { tileProject } from "../../corners/tileProject.js";
import { doubleContourRoomWalls, lShapeWalls, rectangleWalls } from "./fixtures.js";

function projectOf(walls: Wall[]): Project {
  const pourIds = [...new Set(walls.map((wall) => wall.pourId))];
  return {
    id: "external-corner-test",
    name: "external corners",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: pourIds.map((id, order) => ({ id, name: id, color: "#000", order })),
    walls,
    placements: [],
  };
}

function key(point: Point): string {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}

describe("automatic external K30 corners", () => {
  it("finds the four facade corners of a room without saved hints", () => {
    const layout = tileProject(projectOf(rectangleWalls())).layout;

    expect(layout.externalCorners).toHaveLength(4);
    expect(layout.externalCorners.every((corner) => corner.pourId === "pour-1")).toBe(true);
  });

  it("puts K30 on the drawn outer contour, not the paired inner contour", () => {
    const layout = tileProject(projectOf(doubleContourRoomWalls())).layout;

    expect(new Set(layout.externalCorners.map((corner) => key(corner.point)))).toEqual(
      new Set([
        "-20.000,-20.000",
        "420.000,-20.000",
        "420.000,320.000",
        "-20.000,320.000",
      ])
    );
  });

  it("keeps the same result after translating and rotating the user's drawing", () => {
    const transform = ({ x, y }: Point): Point => ({ x: 900 - y, y: 350 + x });
    const walls = rectangleWalls().map((wall) => ({
      ...wall,
      innerLine: wall.innerLine.map(transform) as [Point, Point],
    }));

    const original = tileProject(projectOf(rectangleWalls())).layout.externalCorners;
    const transformed = tileProject(projectOf(walls)).layout.externalCorners;

    expect(new Set(transformed.map((corner) => key(corner.point)))).toEqual(
      new Set(original.map((corner) => key(transform(corner.point))))
    );
  });

  it("rejects the concave notch of an L room and keeps its five convex corners", () => {
    const layout = tileProject(projectOf(lShapeWalls())).layout;

    expect(layout.externalCorners).toHaveLength(5);
    expect(layout.externalCorners.map((corner) => key(corner.point))).not.toContain("200.000,150.000");
  });

  it("classifies disconnected structures independently", () => {
    const first = rectangleWalls();
    const second = rectangleWalls().map((wall) => ({
      ...wall,
      id: `second-${wall.id}`,
      innerLine: wall.innerLine.map(({ x, y }) => ({ x: x + 1000, y: y + 700 })) as [
        Point,
        Point,
      ],
    }));

    expect(tileProject(projectOf([...first, ...second])).layout.externalCorners).toHaveLength(8);
  });

  it("keeps a pour's L corner when another pour turns the shared graph node into a T", () => {
    const secondPourWall: Wall = {
      id: "second-pour-extension",
      pourId: "pour-2",
      innerLine: [
        { x: 0, y: 0 },
        { x: -150, y: 0 },
      ],
      thickness: 20,
    };
    const layout = tileProject(projectOf([...rectangleWalls(), secondPourWall])).layout;
    const firstPourCorners = layout.externalCorners.filter(
      (corner) => corner.pourId === "pour-1"
    );

    expect(layout.nodes.find((node) => key(node.point) === "0.000,0.000")?.type).toBe("T");
    expect(firstPourCorners).toHaveLength(4);
    expect(firstPourCorners.map((corner) => key(corner.point))).toContain("0.000,0.000");
  });
});
