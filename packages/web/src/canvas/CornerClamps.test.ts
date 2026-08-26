import { describe, expect, it } from "vitest";
import type { Point, Project, Wall } from "@rastoplan/core";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG, tileProject } from "@rastoplan/core";
import { computeCornerBrackets } from "./cornerClampGeometry.js";

function ring(thickness: number): Wall[] {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ];
  return points.map((point, index) => ({
    id: `wall-${index}`,
    pourId: "pour-1",
    innerLine: [point, points[(index + 1) % points.length]!] as [Point, Point],
    thickness,
    thicknessSet: true,
  }));
}

function bracketsFor(thickness: number) {
  const walls = ring(thickness);
  const project: Project = {
    id: "project",
    name: "corner clamp test",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [{ id: "pour-1", name: "יציקה 1", color: "#000", order: 0 }],
    walls,
    placements: [],
  };
  const { placements, layout } = tileProject(project);
  return {
    brackets: computeCornerBrackets(
      walls,
      placements,
      layout,
      DEFAULT_ACCESSORY_RULES.cornerClampsPerCorner
    ),
    corners: pointsOf(walls),
  };
}

function pointsOf(walls: Wall[]): Point[] {
  return walls.map((wall) => wall.innerLine[0]);
}

describe("corner clamp drawing", () => {
  it("anchors every K30 just beyond the visible panel band", () => {
    const { brackets, corners } = bracketsFor(20);

    expect(brackets).toHaveLength(4);
    for (const bracket of brackets) {
      const elbow = { x: bracket.points[2]!, y: bracket.points[3]! };
      const nearestCorner = Math.min(
        ...corners.map((corner) => Math.hypot(elbow.x - corner.x, elbow.y - corner.y))
      );
      // 10cm painted band + 4cm clearance on both orthogonal axes.
      expect(nearestCorner).toBeCloseTo(Math.hypot(14, 14));
      expect(Math.hypot(bracket.points[0]! - elbow.x, bracket.points[1]! - elbow.y)).toBeCloseTo(30);
      expect(Math.hypot(bracket.points[4]! - elbow.x, bracket.points[5]! - elbow.y)).toBeCloseTo(30);
      expect(Math.hypot(bracket.labelAt.x - elbow.x, bracket.labelAt.y - elbow.y)).toBeCloseTo(16);
      expect(bracket.count).toBe(3);
    }
  });

  it("does not drift away when the wall thickness changes", () => {
    const thin = bracketsFor(20).brackets.map((bracket) => bracket.points);
    const thick = bracketsFor(80).brackets.map((bracket) => bracket.points);

    expect(thick).toEqual(thin);
  });

  it("uses only the outside corners supplied by the engine", () => {
    const walls = ring(20);
    const project: Project = {
      id: "project",
      name: "derived outside corners",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      catalog: DEFAULT_PANEL_CATALOG,
      rules: DEFAULT_ACCESSORY_RULES,
      pours: [{ id: "pour-1", name: "pour 1", color: "#000", order: 0 }],
      walls,
      placements: [],
    };
    const { placements, layout } = tileProject(project);
    const externalCorners = [
      { point: { x: 0, y: 0 }, pourId: "pour-1" },
      { point: { x: 400, y: 300 }, pourId: "pour-1" },
      // Repeating a reviewed point must not create two physical clamps.
      { point: { x: 400, y: 300 }, pourId: "pour-1" },
    ];

    const brackets = computeCornerBrackets(
      walls,
      placements,
      layout,
      DEFAULT_ACCESSORY_RULES.cornerClampsPerCorner,
      externalCorners
    );

    expect(brackets).toHaveLength(2);
    expect(brackets.every((bracket) => bracket.key.startsWith("external:"))).toBe(true);
    expect(brackets.map((bracket) => bracket.count)).toEqual([3, 3]);
  });

  it("draws a pour's corner even when another pour makes the shared node a global T", () => {
    const walls: Wall[] = [
      ...ring(20),
      {
        id: "pour-2-extension",
        pourId: "pour-2",
        innerLine: [
          { x: 0, y: 0 },
          { x: -150, y: 0 },
        ],
        thickness: 20,
        thicknessSet: true,
      },
    ];
    const project: Project = {
      id: "two-pour-project",
      name: "shared junction",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      catalog: DEFAULT_PANEL_CATALOG,
      rules: DEFAULT_ACCESSORY_RULES,
      pours: [
        { id: "pour-1", name: "pour 1", color: "#000", order: 0 },
        { id: "pour-2", name: "pour 2", color: "#666", order: 1 },
      ],
      walls,
      placements: [],
    };
    const { placements, layout } = tileProject(project);
    const brackets = computeCornerBrackets(
      walls,
      placements,
      layout,
      DEFAULT_ACCESSORY_RULES.cornerClampsPerCorner,
      layout.externalCorners
    );

    expect(layout.nodes.find((node) => node.point.x === 0 && node.point.y === 0)?.type).toBe("T");
    expect(layout.externalCorners.filter((corner) => corner.pourId === "pour-1")).toHaveLength(4);
    expect(brackets.filter((bracket) => bracket.key.startsWith("external:pour-1:"))).toHaveLength(
      4
    );
  });
});
