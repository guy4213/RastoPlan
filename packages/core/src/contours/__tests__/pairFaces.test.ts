import { describe, expect, it } from "vitest";
import type { Point, Wall } from "../../types.js";
import { buildGraph } from "../../geometry/buildGraph.js";
import { classifyNodes } from "../../geometry/classifyNodes.js";
import { buildPlanarFaces } from "../../geometry/planarFaces.js";
import { doubleContourRoomWalls } from "../../geometry/__tests__/fixtures.js";
import { withDefaults } from "../constants.js";
import type { ResolveOptions } from "../constants.js";
import { buildRegions } from "../regions.js";
import { pairFaces } from "../pairFaces.js";
import { resolveWalls } from "../resolveWalls.js";

/** A closed ring through `points` — the two long sides are the candidate faces. */
function ringWalls(points: Point[]): Wall[] {
  return points.map((p, i) => ({
    id: `w${i}`,
    pourId: "pour-1",
    innerLine: [p, points[(i + 1) % points.length]!] as [Point, Point],
    thickness: 20,
  }));
}

function slab(gapCm: number, farGapCm = gapCm): Wall[] {
  return ringWalls([
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: farGapCm },
    { x: 0, y: gapCm },
  ]);
}

function pair(walls: Wall[], options: ResolveOptions = {}) {
  const { nodes, edges } = buildGraph(walls);
  const typed = classifyNodes(nodes, edges);
  const faces = buildPlanarFaces(typed, edges);
  const { regions } = buildRegions(faces, typed);
  return pairFaces(typed, faces, regions, withDefaults(options));
}

describe("pairFaces", () => {
  it("pairs two faces held a constant wall thickness apart", () => {
    const { pairings } = pair(slab(20));

    expect(pairings).toHaveLength(1);
    expect(pairings[0]!.measuredThicknessCm).toBeCloseTo(20);
    expect(pairings[0]!.thicknessVarianceCm).toBeCloseTo(0);
    expect(pairings[0]!.overlapCm).toBeCloseTo(400);
  });

  it("rejects a separation too small to be a wall", () => {
    expect(pair(slab(10)).pairings).toHaveLength(0);
  });

  it("pairs at any thickness by default — the drawing convention decides, not the distance", () => {
    // A bare rectangle pairs on both axes once the ceiling is gone; deciding
    // that it is a room after all is the hole rule's job, not this layer's.
    for (const gap of [70, 250]) {
      const long = pair(slab(gap)).pairings.find(
        (p) => p.edgeAId === "edge:w0" && p.edgeBId === "edge:w2"
      );
      expect(long, `gap=${gap}`).toBeDefined();
      expect(long!.measuredThicknessCm).toBeCloseTo(gap);
    }
  });

  it("still honours an explicit ceiling when one is given", () => {
    expect(pair(slab(70), { maxThicknessCm: 50 }).pairings).toHaveLength(0);
    expect(pair(slab(70), { maxThicknessCm: 90 }).pairings).toHaveLength(1);
  });

  it("rejects faces whose separation drifts along the run", () => {
    const { pairings } = pair(slab(20, 28));

    expect(pairings).toHaveLength(0);
  });

  it("never pairs perpendicular faces", () => {
    const { pairings } = pair(slab(20));

    expect(pairings.every((p) => p.edgeAId !== p.edgeBId)).toBe(true);
    expect(pairings.map((p) => [p.edgeAId, p.edgeBId].sort())).toEqual([
      ["edge:w0", "edge:w2"],
    ]);
  });

  it("marks a pairing where one contour runs past the other", () => {
    // Only the ring between the two contours is wall material; the room inside
    // pairs its own opposite walls geometrically, and the hole rule in
    // resolveWalls is what discards those.
    const { pairings } = resolveWalls(doubleContourRoomWalls());

    expect(pairings).toHaveLength(4);
    for (const pairing of pairings) {
      expect(pairing.flags).toContain("partial-overlap");
    }
    // The outer contour is 40cm longer on each axis; the shared run is the
    // inner wall's own length, not the outer one's.
    expect(pairings.map((p) => Math.round(p.overlapCm)).sort((a, b) => a - b)).toEqual([
      300, 300, 400, 400,
    ]);
  });

  it("scores coverage per boundary segment, so a thick ring is not penalised", () => {
    const { coverageByRegionId } = pair(doubleContourRoomWalls());
    const ring = [...coverageByRegionId.entries()].find(([, c]) => c === 1);

    // 8 boundary segments, 4 pairings, every segment claimed.
    expect(ring).toBeDefined();
  });

  it("falls back to independent walls when an explicit ceiling rules the pairing out", () => {
    const result = resolveWalls(doubleContourRoomWalls(), { maxThicknessCm: 10 });

    expect(result.pairings).toHaveLength(0);
    expect(result.consumedWallIds.size).toBe(0);
    expect(result.resolvedWalls).toHaveLength(8);
  });
});
