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

function outerHull(wallId: string, walls: Wall[], placements: Placement[], layout: ProjectLayout) {
  const wall = walls.find((item) => item.id === wallId)!;
  const frame = resolvedWallFrame(wall, layout, walls);
  const bands = placements
    .filter((placement) => placement.edgeId === `edge:${wallId}` && placement.side === "faceB")
    .map((placement) => placementBand(placement, wall, frame));
  return {
    x0: Math.min(...bands.map((band) => band.x0)),
    y0: Math.min(...bands.map((band) => band.y0)),
    x1: Math.max(...bands.map((band) => band.x1)),
    y1: Math.max(...bands.map((band) => band.y1)),
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

describe("external corner — one panel owns the corner without overlapping", () => {
  it("moves the corner-owning panel 2cm inward at all four corners", () => {
    const walls = ring(0, 0, 400, 300, "w");
    const { painted: placements, layout } = painted(walls);
    const top = outerHull("w-0", walls, placements, layout);
    const right = outerHull("w-1", walls, placements, layout);
    const bottom = outerHull("w-2", walls, placements, layout);
    const left = outerHull("w-3", walls, placements, layout);

    // At the top the vertical starts 2cm below the outside edge; at the bottom
    // it ends 2cm above it.
    expect(right.y0 - top.y0, "top-right offset").toBeCloseTo(GAP_CM);
    expect(left.y0 - top.y0, "top-left offset").toBeCloseTo(GAP_CM);
    expect(bottom.y1 - right.y1, "bottom-right offset").toBeCloseTo(GAP_CM);
    expect(bottom.y1 - left.y1, "bottom-left offset").toBeCloseTo(GAP_CM);

    // Horizontals stop at the side of the vertical band; the panels share an
    // edge for 8cm but never share area.
    expect(top.x0, "top-left meeting edge").toBeCloseTo(left.x1);
    expect(bottom.x0, "bottom-left meeting edge").toBeCloseTo(left.x1);
    expect(top.x1, "top-right meeting edge").toBeCloseTo(right.x0);
    expect(bottom.x1, "bottom-right meeting edge").toBeCloseTo(right.x0);
    expect(top.y1 - right.y0).toBeCloseTo(PANEL_CM - GAP_CM);
  });

  it("does the same on the reported 499x390 two-contour plan", () => {
    const walls = [...ring(0, 0, 499, 390, "out"), ...ring(109.5, 95, 389.5, 295, "in")];
    const { painted: placements, layout } = painted(walls);
    const top = outerHull("in-0", walls, placements, layout);
    const right = outerHull("in-1", walls, placements, layout);
    const bottom = outerHull("in-2", walls, placements, layout);
    const left = outerHull("in-3", walls, placements, layout);

    expect(right.y0 - top.y0).toBeCloseTo(GAP_CM);
    expect(left.y0 - top.y0).toBeCloseTo(GAP_CM);
    expect(bottom.y1 - right.y1).toBeCloseTo(GAP_CM);
    expect(bottom.y1 - left.y1).toBeCloseTo(GAP_CM);
    expect(Math.abs(top.x0 - left.x1)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(top.x1 - right.x0)).toBeLessThanOrEqual(0.5);
  });

  it("does not overlap any pair of external panels", () => {
    const walls = ring(0, 0, 400, 300, "w");
    const { raw, painted: placements, layout } = painted(walls);
    expect(panelOverlapRects(allPaintedBands(walls, placements, layout))).toEqual([]);
    expect(placements.map((placement) => placement.id)).toEqual(
      raw.map((placement) => placement.id)
    );
  });

  it("extends only canvas copies and never mutates calculated placements", () => {
    const walls = ring(0, 0, 400, 300, "w");
    const { raw, painted: copies } = painted(walls);
    const snapshot = raw.map(({ id, offsetAlongEdge, width }) => ({ id, offsetAlongEdge, width }));

    expect(copies).not.toBe(raw);
    expect(raw.map(({ id, offsetAlongEdge, width }) => ({ id, offsetAlongEdge, width }))).toEqual(
      snapshot
    );

    const changed = copies.filter((copy) => {
      const source = raw.find((placement) => placement.id === copy.id)!;
      return copy.offsetAlongEdge !== source.offsetAlongEdge || copy.width !== source.width;
    });
    expect(changed).toHaveLength(4);
    expect(
      changed.every((placement) => {
        const wall = walls.find((item) => item.id === placement.wallId)!;
        const [a, b] = wall.innerLine;
        return Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
      })
    ).toBe(true);
  });

  it("uses the configured clearance rather than hard-coding 2cm", () => {
    const walls = ring(0, 0, 400, 300, "w");
    const { painted: placements, layout } = painted(walls, 6);
    const top = outerHull("w-0", walls, placements, layout);
    const right = outerHull("w-1", walls, placements, layout);
    expect(right.y0 - top.y0).toBeCloseTo(6);
  });
});
