import { describe, expect, it } from "vitest";
import type { Edge, Placement } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { tileWallPair, type WallFaceRun } from "../tileWallPair.js";

const edge: Edge = { id: "edge:1", wallId: "wall:1", nodeA: "n0", nodeB: "n1", clearLength: 0, flags: [] };

function tile(faces: WallFaceRun[]) {
  return tileWallPair({
    edge,
    wallId: "wall:1",
    pourId: "pour-1",
    faces,
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
  });
}

const inner = (startOffset: number, clearLength: number): WallFaceRun => ({
  side: "faceA",
  faceIsInterior: true,
  startOffset,
  clearLength,
});
const outer = (startOffset: number, clearLength: number): WallFaceRun => ({
  side: "faceB",
  faceIsInterior: false,
  startOffset,
  clearLength,
});

const on = (placements: Placement[], side: string) =>
  placements.filter((p) => p.side === side).sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);

/** The seam positions a row produces, as [start, end] pairs. */
const seams = (row: Placement[]) => row.map((p) => [p.offsetAlongEdge, p.offsetAlongEdge + p.width]);

/** The part of a row lying strictly inside a span. */
const within = (row: Placement[], lo: number, hi: number) =>
  row.filter((p) => p.offsetAlongEdge >= lo && p.offsetAlongEdge + p.width <= hi);

/** Fails if a row leaves a gap or overlaps itself anywhere along its run. */
function expectContiguous(row: Placement[], lo: number, hi: number) {
  expect(row.length).toBeGreaterThan(0);
  expect(row[0]!.offsetAlongEdge).toBe(lo);
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1]!;
    expect(prev.offsetAlongEdge + prev.width).toBe(row[i]!.offsetAlongEdge);
  }
  const last = row[row.length - 1]!;
  expect(last.offsetAlongEdge + last.width).toBe(hi);
}

describe("tileWallPair", () => {
  // The measured pair from the customer's own drawing (building B), normalised
  // so the first face starts at zero. Both faces run 425cm; the second is
  // shifted 60cm along, so each owns an exclusive 60cm end at the OPPOSITE end
  // of the wall. See docs/plan-parallel-formwork.md.
  describe("reference pair from the DWG: two 425cm faces offset by 60cm", () => {
    const result = tile([inner(0, 425), outer(60, 425)]);
    const faceA = on(result.placements, "faceA");
    const faceB = on(result.placements, "faceB");

    it("gives each face an exclusive 60cm panel, at opposite ends", () => {
      const headA = within(faceA, 0, 60);
      const tailB = within(faceB, 425, 485);

      expect(headA.map((p) => p.panelType)).toEqual(["R60"]);
      expect(headA[0]!.offsetAlongEdge).toBe(0);

      expect(tailB.map((p) => p.panelType)).toEqual(["R60"]);
      expect(tailB[0]!.offsetAlongEdge).toBe(425);

      // and neither face carries the other's end
      expect(within(faceB, 0, 60)).toHaveLength(0);
      expect(within(faceA, 425, 485)).toHaveLength(0);
    });

    it("carries the identical panel row across the 365cm they share", () => {
      const sharedA = within(faceA, 60, 425);
      const sharedB = within(faceB, 60, 425);

      expect(sharedA.map((p) => p.panelType)).toEqual(sharedB.map((p) => p.panelType));
      expect(seams(sharedA)).toEqual(seams(sharedB));
      // and it really is the whole shared stretch, not a coincidence of two shorts
      expect(sharedA.reduce((sum, p) => sum + p.width, 0)).toBe(365);
    });

    it("covers each face exactly once, with no gap and no overlap", () => {
      expectContiguous(faceA, 0, 425);
      expectContiguous(faceB, 60, 485);
    });

    it("reports no diagnostics: this layout is buildable as drawn", () => {
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("the shared stretch is planned once", () => {
    it("aligns the joints when the outer face wraps both corners", () => {
      // The ordinary room wall: inner run bounded by its corner panels, outer
      // run reaching past each corner by the neighbour's thickness.
      const { placements } = tile([inner(30, 340), outer(-20, 440)]);
      const faceA = on(placements, "faceA");
      const faceB = on(placements, "faceB");

      expect(within(faceA, 30, 370).map((p) => p.panelType)).toEqual(["R75", "R75", "R40", "R75", "R75"]);
      expect(seams(within(faceB, 30, 370))).toEqual(seams(within(faceA, 30, 370)));

      // the outer face's own ends, tiled for it alone
      expect(within(faceB, -20, 30).map((p) => p.panelType)).toEqual(["R50"]);
      expect(within(faceB, 370, 420).map((p) => p.panelType)).toEqual(["R50"]);

      expectContiguous(faceA, 30, 370);
      expectContiguous(faceB, -20, 420);
    });

    it("makes a partition wall between two rooms two identical rows", () => {
      // Both faces border a room, so both runs are bounded by corner panels and
      // there is nothing exclusive to either.
      const { placements } = tile([
        inner(30, 340),
        { side: "faceB", faceIsInterior: true, startOffset: 30, clearLength: 340 },
      ]);
      const faceA = on(placements, "faceA");
      const faceB = on(placements, "faceB");

      expect(faceA.map((p) => p.panelType)).toEqual(["R75", "R75", "R40", "R75", "R75"]);
      expect(faceA.map((p) => p.offsetAlongEdge)).toEqual([30, 105, 180, 220, 295]);
      expect(faceB.map((p) => p.panelType)).toEqual(faceA.map((p) => p.panelType));
      expect(faceB.map((p) => p.offsetAlongEdge)).toEqual(faceA.map((p) => p.offsetAlongEdge));
    });

    it("puts the timber filler at the same offset on both faces", () => {
      // 342 divides into no exact combination, so a 7cm timber gap lands at the
      // centre seam. Because the shared stretch is planned once, that gap is at
      // one offset, not two.
      const { placements } = tile([inner(0, 342), outer(-20, 382)]);
      const timber = placements.filter((p) => p.kind === "timber");

      expect(timber).toHaveLength(2);
      expect(timber[0]!.offsetAlongEdge).toBe(timber[1]!.offsetAlongEdge);
      expect(timber[0]!.side).not.toBe(timber[1]!.side);
      expect(timber[0]!.width).toBe(timber[1]!.width);
    });
  });

  describe("partial overlap: neither face contains the other", () => {
    // 30 of the 166 wall pairs measured in the reference overlap only partially.
    // Tiling exclusive ends onto a single "master" face would leave the other
    // face's end bare, so both are handled.
    it("tiles an exclusive end on BOTH faces", () => {
      const { placements } = tile([inner(0, 410), outer(50, 420)]);
      const faceA = on(placements, "faceA");
      const faceB = on(placements, "faceB");

      expect(within(faceA, 0, 50).reduce((s, p) => s + p.width, 0)).toBe(50);
      expect(within(faceB, 410, 470).reduce((s, p) => s + p.width, 0)).toBe(60);

      expectContiguous(faceA, 0, 410);
      expectContiguous(faceB, 50, 470);
    });

    it("still aligns the stretch the two faces do share", () => {
      const { placements } = tile([inner(0, 410), outer(50, 420)]);
      const sharedA = within(on(placements, "faceA"), 50, 410);
      const sharedB = within(on(placements, "faceB"), 50, 410);

      expect(sharedA.map((p) => p.panelType)).toEqual(sharedB.map((p) => p.panelType));
      expect(seams(sharedA)).toEqual(seams(sharedB));
      expect(sharedA.reduce((s, p) => s + p.width, 0)).toBe(360);
    });
  });

  describe("edges of the rule", () => {
    it("leaves a single drawn face as one independent row", () => {
      const { placements, diagnostics } = tile([inner(0, 340)]);

      expect(placements.map((p) => p.panelType)).toEqual(["R75", "R75", "R40", "R75", "R75"]);
      expect(placements.every((p) => p.side === "faceA")).toBe(true);
      expect(diagnostics).toEqual([]);
    });

    it("flags an untileable end without breaking the alignment of the rest", () => {
      // A 10cm exclusive end is shorter than any panel and longer than the
      // timber range. The shared stretch is unaffected — the operator is told
      // the corner zone is the problem, not the wall.
      const { placements, diagnostics } = tile([inner(0, 340), outer(-10, 350)]);
      const faceA = on(placements, "faceA");
      const faceB = on(placements, "faceB");

      expect(diagnostics.map((d) => d.code)).toEqual(["face-alignment-remainder"]);
      expect(placements.some((p) => p.flags.includes("face-alignment-remainder"))).toBe(true);
      expect(seams(within(faceB, 0, 340))).toEqual(seams(within(faceA, 0, 340)));
    });

    it("reports faces that never meet instead of silently mis-aligning them", () => {
      const { placements, diagnostics } = tile([inner(0, 100), outer(500, 100)]);

      expect(diagnostics.map((d) => d.code)).toEqual(["face-runs-disjoint"]);
      expect(on(placements, "faceA")[0]!.offsetAlongEdge).toBe(0);
      expect(on(placements, "faceB")[0]!.offsetAlongEdge).toBe(500);
    });

    it("returns the same layout every time it runs", () => {
      const once = tile([inner(0, 425), outer(60, 425)]).placements;
      const twice = tile([inner(0, 425), outer(60, 425)]).placements;

      expect(twice).toEqual(once);
    });

    it("gives every placement a unique id", () => {
      const { placements } = tile([inner(30, 340), outer(-20, 440)]);
      expect(new Set(placements.map((p) => p.id)).size).toBe(placements.length);
    });
  });
});
