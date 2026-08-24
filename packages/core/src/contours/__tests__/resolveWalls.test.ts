import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import {
  collinearSplitWallWalls,
  doubleContourLShapeWalls,
  doubleContourRoomWalls,
  doubleContourRoomWallsMixedDirection,
  nestedRoomsWalls,
  rectangleWalls,
  roomWithInteriorWallWalls,
} from "../../geometry/__tests__/fixtures.js";
import { resolveWalls } from "../resolveWalls.js";
import type { ResolvedWall } from "../resolveWalls.js";

function byId(resolvedWalls: ResolvedWall[]): Map<string, ResolvedWall> {
  return new Map(resolvedWalls.map((w) => [w.id, w]));
}

/** Does this wall's outward direction point away from the 400x300 room? */
function pointsAwayFromRoom(wall: ResolvedWall): boolean {
  const [a, b] = wall.centerline;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const n = { x: (b.y - a.y) / length, y: (a.x - b.x) / length };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const probe = {
    x: mid.x + n.x * wall.outwardSign * 10,
    y: mid.y + n.y * wall.outwardSign * 10,
  };
  return probe.x < 0 || probe.x > 400 || probe.y < 0 || probe.y > 300;
}

/** The perpendicular distance actually between a resolved wall's two faces. */
function faceSeparationOf(wall: ResolvedWall): number {
  const [a, b] = wall.faces[0].line;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const mid = {
    x: (wall.faces[1].line[0].x + wall.faces[1].line[1].x) / 2,
    y: (wall.faces[1].line[0].y + wall.faces[1].line[1].y) / 2,
  };
  return Math.abs((b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x)) / length;
}

describe("resolveWalls on the customer's two-contour drawing", () => {
  it("keeps only the inner contour and consumes the outer one", () => {
    const result = resolveWalls(doubleContourRoomWalls());

    expect(result.resolvedWalls.map((w) => w.id).sort()).toEqual([
      "in-bottom",
      "in-left",
      "in-right",
      "in-top",
    ]);
    expect([...result.consumedWallIds].sort()).toEqual([
      "out-bottom",
      "out-left",
      "out-right",
      "out-top",
    ]);
  });

  it("takes the thickness from the gap between the drawn contours", () => {
    // The wall thickness IS the distance between its two faces, and on a
    // two-contour plan the user has already drawn that distance. Preferring a
    // typed number here is what let `thickness` and `faceBOffsetCm` disagree:
    // the BOM sized rods for one wall while the canvas drew another.
    const walls = doubleContourRoomWalls().map((w) => ({ ...w, thickness: 25 }));
    const result = resolveWalls(walls);

    expect(result.resolvedWalls).toHaveLength(4);
    for (const wall of result.resolvedWalls) {
      expect(wall.thicknessSource).toBe("measured");
      expect(wall.thickness).toBe(20);
    }
  });

  it("keeps thickness, faceBOffsetCm and the drawn geometry in step", () => {
    // The three used to be able to drift apart. Whatever the user typed, the
    // number the BOM reads and the offset the canvas draws must both be the
    // distance actually between the two faces.
    for (const declared of [10, 20, 25, 60]) {
      const walls = doubleContourRoomWalls().map((w) => ({ ...w, thickness: declared }));

      for (const wall of resolveWalls(walls).resolvedWalls) {
        expect(wall.faceBOffsetCm, `declared=${declared}`).toBe(wall.thickness);
        expect(faceSeparationOf(wall)).toBeCloseTo(wall.thickness, 1);
      }
    }
  });

  it("gives every wall an interior face A and an exterior face B", () => {
    const result = resolveWalls(doubleContourRoomWalls());

    for (const wall of result.resolvedWalls) {
      expect(wall.faces[0].isInterior).toBe(true);
      expect(wall.faces[1].isInterior).toBe(false);
      expect(wall.faces[1].sourceWallId).toBe(`out-${wall.id.replace("in-", "")}`);
    }
  });

  it("classifies the ring between the contours as wall material, not a room", () => {
    const result = resolveWalls(doubleContourRoomWalls());
    const kinds = result.regions.map((r) => r.kind).sort();

    expect(kinds).toEqual(["outside", "room", "wall-material"]);
    const material = result.regions.find((r) => r.kind === "wall-material")!;
    expect(material.area).toBeCloseTo(440 * 340 - 400 * 300);
  });

  it("points every wall outward regardless of which way it was dragged", () => {
    const straight = resolveWalls(doubleContourRoomWalls());
    const mixed = resolveWalls(doubleContourRoomWallsMixedDirection());

    for (const wall of straight.resolvedWalls) expect(pointsAwayFromRoom(wall)).toBe(true);
    for (const wall of mixed.resolvedWalls) expect(pointsAwayFromRoom(wall)).toBe(true);
    expect(mixed.resolvedWalls).toHaveLength(4);
    expect(mixed.consumedWallIds.size).toBe(4);
  });

  it("pairs the L-shaped plan around its concave corner too", () => {
    const result = resolveWalls(doubleContourLShapeWalls());

    expect(result.resolvedWalls).toHaveLength(6);
    expect(result.consumedWallIds.size).toBe(6);
    expect(result.regions.filter((r) => r.kind === "wall-material")).toHaveLength(1);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(summarize(resolveWalls(doubleContourRoomWalls())))).toBe(
      JSON.stringify(summarize(resolveWalls(doubleContourRoomWalls())))
    );
  });
});

describe("resolveWalls on single-contour drawings", () => {
  it("leaves a plain room untouched and derives its outer face", () => {
    const result = resolveWalls(rectangleWalls());

    expect(result.resolvedWalls).toHaveLength(4);
    expect(result.consumedWallIds.size).toBe(0);
    for (const wall of result.resolvedWalls) {
      expect(wall.thicknessSource).toBe("declared");
      expect(wall.thickness).toBe(20);
      expect(wall.faces[0].isInterior).toBe(true);
      expect(wall.faces[1].isInterior).toBe(false);
      expect(pointsAwayFromRoom(wall)).toBe(true);
    }
  });

  it("treats both faces of a partition between two rooms as interior", () => {
    const result = resolveWalls(roomWithInteriorWallWalls());
    const partition = byId(result.resolvedWalls).get("partition")!;

    expect(partition.faces[0].isInterior).toBe(true);
    expect(partition.faces[1].isInterior).toBe(true);
    expect(partition.faces[0].regionId).not.toBe(partition.faces[1].regionId);
    expect(result.regions.filter((r) => r.kind === "room")).toHaveLength(2);
  });

  it("never treats a plain room as solid wall, however evenly spaced its walls are", () => {
    // A rectangle's two long walls are parallel, evenly separated and facing
    // each other — geometrically indistinguishable from the two sides of a
    // wall. Only the absence of anything nested inside tells them apart.
    const result = resolveWalls(rectangleWalls());

    expect(result.consumedWallIds.size).toBe(0);
    expect(result.resolvedWalls).toHaveLength(4);
    expect(result.regions.filter((r) => r.kind === "wall-material")).toHaveLength(0);
  });

  it("reads two nested contours as one wall ring whatever the distance between them", () => {
    // The customer traces a room as an outer and an inner contour; that
    // convention is the signal, not the measured gap. A plan drawn out of
    // scale must still come back as one wall with two faces.
    const result = resolveWalls(nestedRoomsWalls());

    expect(result.pairings).toHaveLength(4);
    expect(result.consumedWallIds.size).toBe(4);
    expect(result.resolvedWalls).toHaveLength(4);
    expect(result.regions.filter((r) => r.kind === "wall-material")).toHaveLength(1);
  });

  it("gives back the two-room reading when an explicit thickness ceiling is set", () => {
    const result = resolveWalls(nestedRoomsWalls(), { maxThicknessCm: 50 });

    expect(result.pairings).toHaveLength(0);
    expect(result.consumedWallIds.size).toBe(0);
    expect(result.regions.filter((r) => r.kind === "room")).toHaveLength(2);
  });

  it("classifies a free-standing room's corners for the hall around it too", () => {
    const result = resolveWalls(nestedRoomsWalls(), { maxThicknessCm: 50 });
    const roomCorners = result.corners.filter((c) => c.nodeId === cornerNodeId(result, 350, 300));

    // That corner is convex seen from inside the small room and concave seen
    // from the hall wrapping around it — two corners, not one. Before this,
    // only bounded cycles were walked, so the hall's side of every hole
    // boundary produced nothing at all.
    expect(roomCorners).toHaveLength(2);
    expect(roomCorners.map((c) => c.side).sort()).toEqual(["inner", "outer"]);
    expect(roomCorners.map((c) => Math.round(c.interiorAngleDeg)).sort((a, b) => a - b)).toEqual([
      90, 270,
    ]);

    // 4 hall corners (one room each) + 4 room corners (two rooms each).
    expect(result.corners).toHaveLength(12);
  });

  it("carries a wall split into two collinear halves without inventing a corner", () => {
    const result = resolveWalls(collinearSplitWallWalls());

    expect(result.resolvedWalls).toHaveLength(5);
    expect(result.corners).toHaveLength(4);
    expect(result.nodes.filter((n) => n.type === "straight-join")).toHaveLength(1);
  });

  it("does not second-guess the typed thickness", () => {
    const walls: Wall[] = doubleContourRoomWalls().map((w) => ({ ...w, thickness: 40 }));
    const codes = resolveWalls(walls).diagnostics.map((d) => d.code);

    expect(codes).not.toContain("thickness-mismatch");
  });
});

function cornerNodeId(result: ReturnType<typeof resolveWalls>, x: number, y: number): string {
  return result.nodes.find((n) => Math.abs(n.point.x - x) < 1 && Math.abs(n.point.y - y) < 1)!.id;
}

function summarize(result: ReturnType<typeof resolveWalls>) {
  return {
    walls: result.resolvedWalls.map((w) => ({
      id: w.id,
      thickness: w.thickness,
      outwardSign: w.outwardSign,
      interior: w.faces.map((f) => f.isInterior),
    })),
    consumed: [...result.consumedWallIds].sort(),
    regions: result.regions.map((r) => ({ id: r.id, kind: r.kind })),
  };
}
