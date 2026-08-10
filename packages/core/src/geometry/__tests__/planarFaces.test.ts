import { describe, expect, it } from "vitest";
import type { Point, Wall } from "../../types.js";
import { buildGraph } from "../buildGraph.js";
import { buildPlanarFaces } from "../planarFaces.js";
import type { PlanarFacesResult } from "../planarFaces.js";
import { pointInPolygon, unitNormal } from "../polygon.js";
import {
  doubleContourRoomWalls,
  lShapeWalls,
  nestedRoomsWalls,
  rectangleWalls,
  roomWithInteriorWallWalls,
  tJunctionWalls,
} from "./fixtures.js";

function faces(walls: Wall[]): PlanarFacesResult & { edgeCount: number } {
  const { nodes, edges } = buildGraph(walls);
  return { ...buildPlanarFaces(nodes, edges), edgeCount: edges.length };
}

function bounded(result: PlanarFacesResult) {
  return result.cycles.filter((c) => !c.isUnbounded);
}

describe("buildPlanarFaces", () => {
  it("splits a plain rectangle into one bounded and one unbounded cycle", () => {
    const result = faces(rectangleWalls());

    expect(result.cycles).toHaveLength(2);
    expect(bounded(result)).toHaveLength(1);
    for (const cycle of result.cycles) {
      expect(Math.abs(cycle.signedArea)).toBe(400 * 300);
    }
    expect(Math.sign(result.cycles[0]!.signedArea)).toBe(
      -Math.sign(result.cycles[1]!.signedArea)
    );
  });

  it("puts the room on regionSideOfDart of every dart of the bounded cycle", () => {
    const walls = rectangleWalls();
    const { nodes, edges } = buildGraph(walls);
    const result = buildPlanarFaces(nodes, edges);
    const pointByNodeId = new Map(nodes.map((n) => [n.id, n.point]));
    const room: Point[] = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];

    const cycle = bounded(result)[0]!;
    expect(cycle.dartIds).toHaveLength(4);

    for (const dartId of cycle.dartIds) {
      const dart = result.darts.get(dartId)!;
      const from = pointByNodeId.get(dart.from)!;
      const to = pointByNodeId.get(dart.to)!;
      const n = unitNormal(from, to)!;
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const probe = {
        x: mid.x + n.x * result.regionSideOfDart * 1,
        y: mid.y + n.y * result.regionSideOfDart * 1,
      };
      expect(pointInPolygon(probe, room)).toBe(true);
    }
  });

  it("measures the L-shape's bounded face as the notched area", () => {
    const result = faces(lShapeWalls());

    expect(result.cycles).toHaveLength(2);
    const [face] = bounded(result);
    expect(Math.abs(face!.signedArea)).toBe(400 * 300 - 200 * 150);
  });

  it("finds a separate room on each side of an interior partition", () => {
    const result = faces(roomWithInteriorWallWalls());

    expect(result.cycles).toHaveLength(3);
    expect(bounded(result)).toHaveLength(2);
    for (const face of bounded(result)) {
      expect(Math.abs(face.signedArea)).toBe(200 * 300);
    }

    const partitionCycles = new Set(
      [...result.darts.values()]
        .filter((d) => d.edgeId === "edge:partition")
        .map((d) => result.cycleIdByDartId.get(d.id))
    );
    expect(partitionCycles.size).toBe(2);
  });

  it("keeps the two drawn contours as two components with two unbounded faces", () => {
    const result = faces(doubleContourRoomWalls());

    expect(result.cycles).toHaveLength(4);
    expect(result.cycles.filter((c) => c.isUnbounded)).toHaveLength(2);
    expect(new Set(result.cycles.map((c) => c.componentId)).size).toBe(2);
  });

  it("nests a free-standing room inside a hall without merging their faces", () => {
    const result = faces(nestedRoomsWalls());

    expect(bounded(result)).toHaveLength(2);
    const areas = bounded(result)
      .map((c) => Math.abs(c.signedArea))
      .sort((a, b) => a - b);
    expect(areas).toEqual([300 * 200, 1000 * 800]);
  });

  it("flags a wall tree that encloses nothing instead of inventing a face", () => {
    const result = faces(tJunctionWalls());

    expect(result.flags).toContain("degenerate-graph");
    expect(bounded(result)).toHaveLength(0);
  });

  it("consumes every dart exactly once across all cycles", () => {
    for (const walls of [
      rectangleWalls(),
      lShapeWalls(),
      tJunctionWalls(),
      roomWithInteriorWallWalls(),
      doubleContourRoomWalls(),
      nestedRoomsWalls(),
    ]) {
      const result = faces(walls);
      const seen = result.cycles.flatMap((c) => c.dartIds);
      expect(seen).toHaveLength(result.edgeCount * 2);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });
});
