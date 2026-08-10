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

  it("measures the thickness from the drawing instead of trusting the typed value", () => {
    const result = resolveWalls(doubleContourRoomWalls());

    for (const wall of result.resolvedWalls) {
      expect(wall.thicknessSource).toBe("measured");
      expect(wall.thickness).toBeCloseTo(20);
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

  it("refuses to pair a free-standing room with the hall around it", () => {
    const result = resolveWalls(nestedRoomsWalls());

    expect(result.pairings).toHaveLength(0);
    expect(result.consumedWallIds.size).toBe(0);
    expect(result.resolvedWalls).toHaveLength(8);
    expect(result.regions.filter((r) => r.kind === "room")).toHaveLength(2);
  });

  it("carries a wall split into two collinear halves without inventing a corner", () => {
    const result = resolveWalls(collinearSplitWallWalls());

    expect(result.resolvedWalls).toHaveLength(5);
    expect(result.corners).toHaveLength(4);
    expect(result.nodes.filter((n) => n.type === "straight-join")).toHaveLength(1);
  });

  it("reports a thickness that contradicts the drawing", () => {
    const walls: Wall[] = doubleContourRoomWalls().map((w) => ({ ...w, thickness: 40 }));
    const codes = resolveWalls(walls).diagnostics.map((d) => d.code);

    expect(codes).toContain("thickness-mismatch");
  });
});

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
