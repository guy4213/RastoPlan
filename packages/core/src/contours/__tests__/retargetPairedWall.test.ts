import { describe, expect, it } from "vitest";
import type { Point, Wall } from "../../types.js";
import { doubleContourRoomWallsAt } from "../../geometry/__tests__/fixtures.js";
import { resolveWalls } from "../resolveWalls.js";
import { retargetPairedWall, retargetWallThickness } from "../retargetPairedWall.js";

function wall(id: string, a: Point, b: Point, thickness = 20): Wall {
  return { id, pourId: "pour-1", innerLine: [a, b], thickness };
}

const inner = wall("inner", { x: 0, y: 0 }, { x: 400, y: 0 });
const outer = wall("outer", { x: -20, y: -20 }, { x: 420, y: -20 });

function lengthOf(w: Wall): number {
  return Math.hypot(
    w.innerLine[1].x - w.innerLine[0].x,
    w.innerLine[1].y - w.innerLine[0].y
  );
}

/** How far `w` sits from the anchor line, perpendicular and signed. */
function signedGap(anchor: Wall, w: Wall): number {
  const [a, b] = anchor.innerLine;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const mid = {
    x: (w.innerLine[0].x + w.innerLine[1].x) / 2,
    y: (w.innerLine[0].y + w.innerLine[1].y) / 2,
  };
  return ((b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x)) / length;
}

describe("retargetPairedWall", () => {
  it("moves the partner to the new separation and leaves the anchor alone", () => {
    const { wall: moved, diagnostic } = retargetPairedWall(inner, outer, 35);

    expect(diagnostic).toBeUndefined();
    expect(Math.abs(signedGap(inner, moved))).toBeCloseTo(35);
    expect(moved.thickness).toBe(35);
  });

  it("does not change the wall's length", () => {
    for (const thickness of [5, 12, 35, 80, 101, 300]) {
      const { wall: moved } = retargetPairedWall(inner, outer, thickness);
      expect(lengthOf(moved), `thickness=${thickness}`).toBeCloseTo(lengthOf(outer));
    }
  });

  it("does not slide the wall along its own axis", () => {
    // Only the perpendicular offset may change: the outer contour's extent past
    // each corner is what faceRuns reads to size the outer run, so sliding it
    // would silently retile the wall.
    const { wall: moved } = retargetPairedWall(inner, outer, 35);

    expect(moved.innerLine[0].x).toBeCloseTo(outer.innerLine[0].x);
    expect(moved.innerLine[1].x).toBeCloseTo(outer.innerLine[1].x);
  });

  it("keeps the partner on the side it was already on", () => {
    const above = wall("above", { x: -20, y: 20 }, { x: 420, y: 20 });

    // The partner below stays below and the one above stays above, at every
    // thickness — a flip here would turn the wall inside out.
    expect(Math.sign(signedGap(inner, retargetPairedWall(inner, outer, 60).wall))).toBe(
      Math.sign(signedGap(inner, outer))
    );
    expect(Math.sign(signedGap(inner, retargetPairedWall(inner, above, 60).wall))).toBe(
      Math.sign(signedGap(inner, above))
    );
  });

  it("works when the wall was drawn backwards", () => {
    const backwards = wall("inner", { x: 400, y: 0 }, { x: 0, y: 0 });
    const { wall: moved } = retargetPairedWall(backwards, outer, 35);

    expect(Math.abs(signedGap(backwards, moved))).toBeCloseTo(35);
    expect(Math.sign(signedGap(backwards, moved))).toBe(Math.sign(signedGap(backwards, outer)));
  });

  it("refuses a thickness the geometry engine could not resolve, with a reason", () => {
    for (const thickness of [0, 2, 4, -10, Number.NaN]) {
      const result = retargetPairedWall(inner, outer, thickness);

      expect(result.wall, `thickness=${thickness}`).toEqual(outer);
      expect(result.diagnostic?.code).toBe("thickness-below-geometry-resolution");
      expect(result.diagnostic?.severity).toBe("error");
    }
  });

  it("refuses a zero-length anchor rather than guessing a direction", () => {
    const degenerate = wall("inner", { x: 0, y: 0 }, { x: 0, y: 0 });
    const result = retargetPairedWall(degenerate, outer, 35);

    expect(result.wall).toEqual(outer);
    expect(result.diagnostic?.code).toBe("degenerate-anchor-wall");
  });

  it("puts every wall of a contour on the offset the engine will measure back", () => {
    // Retarget each pair of a closed two-contour room from 10 to 25 and the
    // moved lines land exactly where the 25cm version of the same room draws
    // them. This is what makes the next compute measure 25 rather than
    // re-measuring 10 and overwriting what the user typed.
    const from = doubleContourRoomWallsAt(10);
    const expected = new Map(doubleContourRoomWallsAt(25).map((w) => [w.id, w]));

    for (const side of ["bottom", "right", "top", "left"]) {
      const anchor = from.find((w) => w.id === `in-${side}`)!;
      const partner = from.find((w) => w.id === `out-${side}`)!;
      const { wall: moved } = retargetPairedWall(anchor, partner, 25);

      expect(Math.abs(signedGap(anchor, moved)), side).toBeCloseTo(25);
      expect(Math.abs(signedGap(anchor, expected.get(`out-${side}`)!)), side).toBeCloseTo(25);
    }
  });

  it("on its own it opens the contour's corners, which is why the mitre exists", () => {
    // Translating one segment of a closed ring perpendicular by delta leaves a
    // delta-sized gap at each of its two corners, well past buildGraph's 2cm
    // snap — so the ring comes apart and the plan stops resolving. The
    // primitive is right; closing the corners is retargetWallThickness's job.
    const walls = doubleContourRoomWallsAt(10);
    const anchor = walls.find((w) => w.id === "in-bottom")!;
    const partner = walls.find((w) => w.id === "out-bottom")!;

    const { wall: moved } = retargetPairedWall(anchor, partner, 25);
    const neighbourEnd = walls.find((w) => w.id === "out-left")!.innerLine[1];

    expect(
      Math.hypot(moved.innerLine[0].x - neighbourEnd.x, moved.innerLine[0].y - neighbourEnd.y)
    ).toBeCloseTo(15);
    expect(
      resolveWalls(walls.map((w) => (w.id === partner.id ? moved : w))).resolvedWalls
    ).not.toHaveLength(4);
  });
});

/** doubleContourRoomWallsAt with the pairing the engine would have written. */
function pairedRoom(thicknessCm: number): Wall[] {
  const walls = doubleContourRoomWallsAt(thicknessCm);
  return walls.map((w) => ({
    ...w,
    pairedWallId: w.id.startsWith("in-")
      ? w.id.replace("in-", "out-")
      : w.id.replace("out-", "in-"),
  }));
}

describe("retargetWallThickness", () => {
  it("round-trips: what it writes, the engine measures back", () => {
    // The whole point. Without the mitre the ring opens, the pairing fails, and
    // the next compute re-measures the OLD gap and overwrites what was typed.
    const { walls, applied } = retargetWallThickness(pairedRoom(10), "in-bottom", 25);
    expect(applied).toBe(true);

    const resolved = resolveWalls(walls);
    expect(resolved.resolvedWalls).toHaveLength(4);

    const bottom = resolved.resolvedWalls.find((w) => w.id === "in-bottom");
    expect(bottom?.thickness).toBe(25);
    expect(bottom?.faceBOffsetCm).toBe(25);
  });

  it("changes only the edited wall's thickness, not its neighbours'", () => {
    // A mitred neighbour slides along its own axis, so its distance from its
    // own partner — and therefore its own thickness — is untouched.
    const { walls } = retargetWallThickness(pairedRoom(10), "in-bottom", 25);

    for (const wall of resolveWalls(walls).resolvedWalls) {
      expect(wall.thickness, wall.id).toBe(wall.id === "in-bottom" ? 25 : 10);
    }
  });

  it("keeps the far contour closed", () => {
    const { walls } = retargetWallThickness(pairedRoom(10), "in-bottom", 25);
    const byId = new Map(walls.map((w) => [w.id, w]));

    // out-left ends where out-bottom starts, and out-right starts where it ends.
    expect(byId.get("out-left")!.innerLine[1]).toEqual(byId.get("out-bottom")!.innerLine[0]);
    expect(byId.get("out-bottom")!.innerLine[1]).toEqual(byId.get("out-right")!.innerLine[0]);
  });

  it("works at every thickness, up and down", () => {
    for (const [from, to] of [[10, 25], [25, 10], [20, 5], [5, 60], [8, 8.5]]) {
      const { walls } = retargetWallThickness(pairedRoom(from!), "in-right", to!);
      const right = resolveWalls(walls).resolvedWalls.find((w) => w.id === "in-right");

      expect(right?.thickness, `${from}->${to}`).toBe(to);
    }
  });

  it("does not move the wall the user is editing", () => {
    const before = pairedRoom(10).find((w) => w.id === "in-bottom")!;
    const { walls } = retargetWallThickness(pairedRoom(10), "in-bottom", 25);

    expect(walls.find((w) => w.id === "in-bottom")!.innerLine).toEqual(before.innerLine);
  });

  it("just sets the field on a wall drawn as a single line", () => {
    const single = [
      { id: "solo", pourId: "pour-1", innerLine: [{ x: 0, y: 0 }, { x: 400, y: 0 }] as [Point, Point], thickness: 20 },
    ];
    const { walls, applied } = retargetWallThickness(single, "solo", 35);

    expect(applied).toBe(true);
    expect(walls[0]!.thickness).toBe(35);
    expect(walls[0]!.innerLine).toEqual(single[0]!.innerLine);
  });

  it("refuses, with a reason, when the partner has been deleted", () => {
    const orphaned = pairedRoom(10).filter((w) => w.id !== "out-bottom");
    const result = retargetWallThickness(orphaned, "in-bottom", 25);

    expect(result.applied).toBe(false);
    expect(result.walls).toBe(orphaned);
    expect(result.diagnostics[0]?.code).toBe("paired-wall-missing");
  });

  it("refuses a thickness below what the geometry engine can resolve", () => {
    const result = retargetWallThickness(pairedRoom(10), "in-bottom", 2);

    expect(result.applied).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("thickness-below-geometry-resolution");
  });
});
