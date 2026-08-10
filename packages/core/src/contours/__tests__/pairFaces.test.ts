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

  it("rejects a separation too large to be a wall", () => {
    expect(pair(slab(250)).pairings).toHaveLength(0);
  });

  it("honours a widened thickness band for thick basement walls", () => {
    expect(pair(slab(70)).pairings).toHaveLength(0);
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
    const { pairings } = pair(doubleContourRoomWalls());

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

  it("drives the region kind through the coverage threshold", () => {
    const { coverageByRegionId } = pair(slab(20));
    const material = [...coverageByRegionId.values()].filter((c) => c > 0);

    expect(material).toHaveLength(1);
    expect(material[0]).toBeGreaterThan(0.8);
  });

  it("falls back to independent walls when the coverage bar is raised out of reach", () => {
    const result = resolveWalls(doubleContourRoomWalls(), { materialMinCoverage: 0.99 });

    expect(result.consumedWallIds.size).toBe(0);
    expect(result.diagnostics.map((d) => d.code)).toContain("region-coverage-ambiguous");
  });
});
