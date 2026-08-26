import { describe, expect, it } from "vitest";
import type { Placement, Point, Project, ProjectLayout, Wall } from "@rastoplan/core";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG, tileProject } from "@rastoplan/core";
import {
  panelOverlapRects,
  placementBand,
  placementsWithOuterCornerJoint,
} from "./geometry.js";
import { resolvedWallFrame } from "./resolvedWallFrame.js";

const PANEL_CM = DEFAULT_ACCESSORY_RULES.outerCornerProtrusionCm;
const GAP_CM = DEFAULT_ACCESSORY_RULES.outerCornerLapGapCm;

function ring(x0: number, y0: number, x1: number, y1: number, prefix: string): Wall[] {
  const pts: Point[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  return pts.map((point, index) => ({
    id: `${prefix}-${index}`,
    pourId: "pour-1",
    innerLine: [point, pts[(index + 1) % pts.length]!] as [Point, Point],
    thickness: 20,
  }));
}

function projectOf(walls: Wall[]): Project {
  return {
    id: "p",
    name: "n",
    createdAt: "",
    updatedAt: "",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [{ id: "pour-1", name: "pour", color: "#000", order: 0 }],
    walls,
    placements: [],
    schemaVersion: 3,
  };
}

function painted(
  walls: Wall[],
  clearanceCm: number = GAP_CM
): { raw: Placement[]; painted: Placement[]; layout: ProjectLayout } {
  const { placements: raw, layout } = tileProject(projectOf(walls));
  return {
    raw,
    painted: placementsWithOuterCornerJoint(raw, walls, layout, PANEL_CM, clearanceCm),
    layout,
  };
}

function allPaintedBands(walls: Wall[], placements: Placement[], layout: ProjectLayout) {
  return placements.flatMap((placement) => {
    if (placement.kind === "corner-panel") return [];
    const wall = walls.find((item) => item.id === placement.wallId);
    if (!wall) return [];
    return [
      {
        edgeId: placement.edgeId,
        band: placementBand(placement, wall, resolvedWallFrame(wall, layout, walls)),
      },
    ];
  });
}

describe("one formwork row per drawn wall", () => {
  it("does not synthesize a second face while painting a rectangular room", () => {
    const walls = ring(0, 0, 400, 300, "w");
    const { raw, painted: placements } = painted(walls);

    expect(placements).toBe(raw);
    expect(new Set(placements.map((placement) => placement.side))).toEqual(new Set(["faceA"]));
  });

  it("keeps one row on each drawn contour of the reported 499x390 plan", () => {
    const walls = [...ring(0, 0, 499, 390, "out"), ...ring(109.5, 95, 389.5, 295, "in")];
    const { raw, painted: placements } = painted(walls);

    expect(placements).toHaveLength(raw.length);
    expect(placements.map((placement) => placement.id)).toEqual(
      raw.map((placement) => placement.id)
    );
    expect(new Set(placements.map((placement) => placement.side))).toEqual(
      new Set(["faceA", "faceB"])
    );
  });

  it("does not overlap any pair of external panels", () => {
    const walls = ring(0, 0, 400, 300, "w");
    const { raw, painted: placements, layout } = painted(walls);
    expect(panelOverlapRects(allPaintedBands(walls, placements, layout))).toEqual([]);
    expect(placements.map((placement) => placement.id)).toEqual(
      raw.map((placement) => placement.id)
    );
  });

  it("does not create canvas-only extensions when no second face exists", () => {
    const walls = ring(0, 0, 400, 300, "w");
    const { raw, painted: copies } = painted(walls);
    const snapshot = raw.map(({ id, offsetAlongEdge, width }) => ({ id, offsetAlongEdge, width }));

    expect(copies).toBe(raw);
    expect(raw.map(({ id, offsetAlongEdge, width }) => ({ id, offsetAlongEdge, width }))).toEqual(
      snapshot
    );
  });

  it("does not let an obsolete outer-face clearance recreate a row", () => {
    const walls = ring(0, 0, 400, 300, "w");
    const { raw, painted: placements } = painted(walls, 6);
    expect(placements).toBe(raw);
    expect(placements.some((placement) => placement.side === "faceB")).toBe(false);
  });
});
