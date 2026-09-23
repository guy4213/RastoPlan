import { describe, expect, it } from "vitest";
import type { Point, Wall } from "../../types.js";
import { doubleContourRoomWallsAt } from "../../geometry/__tests__/fixtures.js";
import { resolveWalls } from "../resolveWalls.js";
import { outerContourWallId, retargetPairedWall, retargetWallThickness } from "../retargetPairedWall.js";

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

  it("does not move the wall the user is editing — the fallback used whenever the outer contour is not given", () => {
    // `resolvedWalls` is omitted here on purpose: this is exactly the
    // pre-13/9/2026 behavior, kept as the default for the three cases where
    // the outer contour cannot be identified — see the "outer contour never
    // moves" describe block below for what changes once it CAN be identified.
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

/**
 * A rectangle drawn as two contours with per-side thickness: 30cm left/right,
 * 20cm top/bottom. The outer footprint is exactly 500x400; the inner rectangle
 * is inset accordingly (440x360). This is the customer's own worked example
 * for the outer-stays-put rule (13/9/2026).
 */
function mixedThicknessRectangle(): Wall[] {
  const line = (
    id: string,
    a: Point,
    b: Point,
    thickness: number,
    pair: string
  ): Wall => ({ id, pourId: "pour-1", innerLine: [a, b], thickness, pairedWallId: pair });

  return [
    line("in-bottom", { x: 30, y: 20 }, { x: 470, y: 20 }, 20, "out-bottom"),
    line("in-right", { x: 470, y: 20 }, { x: 470, y: 380 }, 30, "out-right"),
    line("in-top", { x: 470, y: 380 }, { x: 30, y: 380 }, 20, "out-top"),
    line("in-left", { x: 30, y: 380 }, { x: 30, y: 20 }, 30, "out-left"),
    line("out-bottom", { x: 0, y: 0 }, { x: 500, y: 0 }, 20, "in-bottom"),
    line("out-right", { x: 500, y: 0 }, { x: 500, y: 400 }, 30, "in-right"),
    line("out-top", { x: 500, y: 400 }, { x: 0, y: 400 }, 20, "in-top"),
    line("out-left", { x: 0, y: 400 }, { x: 0, y: 0 }, 30, "in-left"),
  ];
}

describe("retargetWallThickness -- the outer contour never moves (customer decision, 13/9/2026)", () => {
  it("moves the inner wall and leaves the outer one exactly where it was drawn", () => {
    const before = pairedRoom(10);
    const resolvedWalls = resolveWalls(before).resolvedWalls;
    const outerBefore = before.find((w) => w.id === "out-bottom")!;
    const innerBefore = before.find((w) => w.id === "in-bottom")!;

    const { walls, applied } = retargetWallThickness(before, "in-bottom", 25, resolvedWalls);

    expect(applied).toBe(true);
    expect(walls.find((w) => w.id === "out-bottom")!.innerLine).toEqual(outerBefore.innerLine);
    expect(walls.find((w) => w.id === "in-bottom")!.innerLine).not.toEqual(innerBefore.innerLine);
  });

  it("gives the same result whichever of the pair the user actually selects", () => {
    const before = pairedRoom(10);
    const resolvedWalls = resolveWalls(before).resolvedWalls;
    const outerBefore = before.find((w) => w.id === "out-bottom")!;

    // Editing FROM the outer wall directly: it is already the outer contour,
    // so it stays put either way -- this just confirms the two entry points
    // agree rather than one of them accidentally moving the outer line.
    const { walls } = retargetWallThickness(before, "out-bottom", 25, resolvedWalls);

    expect(walls.find((w) => w.id === "out-bottom")!.innerLine).toEqual(outerBefore.innerLine);
    expect(walls.find((w) => w.id === "out-bottom")!.thickness).toBe(25);
  });

  it("outerContourWallId names the outer wall of a normal exterior pair", () => {
    const walls = pairedRoom(10);
    const resolvedWalls = resolveWalls(walls).resolvedWalls;

    expect(outerContourWallId(resolvedWalls, "in-bottom", "out-bottom")).toBe("out-bottom");
    // Order of the two ids must not matter.
    expect(outerContourWallId(resolvedWalls, "out-bottom", "in-bottom")).toBe("out-bottom");
  });

  it("keeps a 500x400 outer footprint fixed under mixed 30/30/20/20 thickness, with the inner corners still closed", () => {
    const before = mixedThicknessRectangle();
    const resolvedWalls = resolveWalls(before).resolvedWalls;
    const outerIds = ["out-bottom", "out-right", "out-top", "out-left"];
    const outerBefore = new Map(outerIds.map((id) => [id, before.find((w) => w.id === id)!.innerLine]));

    // Editing the bottom wall's thickness from the inner side -- the wall
    // whose corners actually need to close around the new gap.
    const { walls, applied } = retargetWallThickness(before, "in-bottom", 35, resolvedWalls);
    expect(applied).toBe(true);

    // The full outer 500x400 footprint -- including the two mixed corners --
    // is untouched by an inner-side edit.
    for (const id of outerIds) {
      expect(walls.find((w) => w.id === id)!.innerLine, id).toEqual(outerBefore.get(id));
    }

    const inBottom = walls.find((w) => w.id === "in-bottom")!;
    const inLeft = walls.find((w) => w.id === "in-left")!;
    const inRight = walls.find((w) => w.id === "in-right")!;
    const inTop = walls.find((w) => w.id === "in-top")!;

    // The edited wall moved to the new 35cm gap from its (unmoved) outer partner.
    expect(inBottom.innerLine[0].y).toBeCloseTo(35);
    expect(inBottom.innerLine[1].y).toBeCloseTo(35);
    // Its own left/right extent is unchanged -- only the perpendicular offset moved.
    expect(inBottom.innerLine[0].x).toBeCloseTo(30);
    expect(inBottom.innerLine[1].x).toBeCloseTo(470);

    // Both neighbours re-mitred onto it -- the corners are still closed --
    // while their OTHER, untouched thickness (30cm from the outer right/left)
    // is preserved: the far end of each did not move.
    // (in-left is drawn far-end-first: [0] is the top corner it shares with
    // in-top, [1] is the bottom corner it shares with in-bottom.)
    expect(inLeft.innerLine[1]).toEqual(inBottom.innerLine[0]);
    expect(inRight.innerLine[0]).toEqual(inBottom.innerLine[1]);
    expect(inLeft.innerLine[0]).toEqual({ x: 30, y: 380 });
    expect(inRight.innerLine[1]).toEqual({ x: 470, y: 380 });
    // The far wall, which the edit never reaches, is untouched.
    expect(inTop.innerLine).toEqual([{ x: 470, y: 380 }, { x: 30, y: 380 }]);
  });

  it("keeps a live drag preview and the committed edit in agreement", () => {
    // Walls.tsx previews a thickness drag by calling retargetWallThickness on
    // every pointer move with the same resolvedWalls the eventual dispatch
    // uses -- so the committed result IS this same function call, not a
    // separate code path to test independently.
    const before = pairedRoom(10);
    const resolvedWalls = resolveWalls(before).resolvedWalls;

    const preview = retargetWallThickness(before, "in-bottom", 25, resolvedWalls);
    const committed = retargetWallThickness(before, "in-bottom", 25, resolvedWalls);

    expect(preview.walls).toEqual(committed.walls);
  });

  it("falls back to keeping the edited wall stationary for a partition -- both faces border a room, so neither is 'outer'", () => {
    // A two-contour partition between two rooms: both sides drawn, but both
    // faces border a room, so there is no outer contour to prefer.
    const wall = (id: string, a: Point, b: Point, pair: string): Wall => ({
      id,
      pourId: "pour-1",
      innerLine: [a, b],
      thickness: 20,
      pairedWallId: pair,
    });
    const walls: Wall[] = [
      // Room A, to the left of the partition.
      wall("a-left", { x: 0, y: 0 }, { x: 0, y: 300 }, ""),
      wall("a-top", { x: 0, y: 300 }, { x: 200, y: 300 }, ""),
      wall("a-bottom", { x: 0, y: 0 }, { x: 200, y: 0 }, ""),
      // Room B, to the right -- its left wall is the partition's far contour.
      wall("b-top", { x: 220, y: 300 }, { x: 420, y: 300 }, ""),
      wall("b-bottom", { x: 220, y: 0 }, { x: 420, y: 0 }, ""),
      wall("b-right", { x: 420, y: 0 }, { x: 420, y: 300 }, ""),
      // The partition itself: two contours, 20cm apart, a room on each side.
      wall("part-left", { x: 200, y: 0 }, { x: 200, y: 300 }, "part-right"),
      wall("part-right", { x: 220, y: 300 }, { x: 220, y: 0 }, "part-left"),
    ];
    const resolvedWalls = resolveWalls(walls).resolvedWalls;
    expect(outerContourWallId(resolvedWalls, "part-left", "part-right")).toBeNull();

    const before = walls.find((w) => w.id === "part-left")!;
    const { walls: after } = retargetWallThickness(walls, "part-left", 30, resolvedWalls);

    expect(after.find((w) => w.id === "part-left")!.innerLine).toEqual(before.innerLine);
  });

  it("falls back to keeping the edited wall stationary rather than tear open a T that only partly paired with the outer contour", () => {
    // The inner bottom wall is split at (200,0) by a partition, so only ONE
    // of the two resulting segments pairs with the single outer wall -- the
    // engine's own contour-pairing choice, not something this fix controls.
    // Moving that one segment alone (the plain "outer stays" rule) would slide
    // it away from its sibling and tear the T corner open, since nothing
    // re-mitres a wall that was never paired with what moved. That is a real
    // geometry defect, not a cosmetic warning, so it must not happen: the
    // move falls back to the safe default instead.
    const wall = (id: string, a: Point, b: Point, thickness: number, pair?: string): Wall => ({
      id,
      pourId: "pour-1",
      innerLine: [a, b],
      thickness,
      ...(pair ? { pairedWallId: pair } : {}),
    });
    const walls: Wall[] = [
      wall("in-bottom-left", { x: 0, y: 0 }, { x: 200, y: 0 }, 20, "out-bottom"),
      wall("in-bottom-right", { x: 200, y: 0 }, { x: 400, y: 0 }, 20, "out-bottom"),
      wall("in-right", { x: 400, y: 0 }, { x: 400, y: 300 }, 20, "out-right"),
      wall("in-top", { x: 400, y: 300 }, { x: 0, y: 300 }, 20, "out-top"),
      wall("in-left", { x: 0, y: 300 }, { x: 0, y: 0 }, 20, "out-left"),
      wall("partition", { x: 200, y: 0 }, { x: 200, y: 150 }, 20),
      wall("out-bottom", { x: -20, y: -20 }, { x: 420, y: -20 }, 20),
      wall("out-right", { x: 420, y: -20 }, { x: 420, y: 320 }, 20),
      wall("out-top", { x: 420, y: 320 }, { x: -20, y: 320 }, 20),
      wall("out-left", { x: -20, y: 320 }, { x: -20, y: -20 }, 20),
    ];
    const resolvedWalls = resolveWalls(walls).resolvedWalls;
    // resolveWalls does pick an outer contour for the edited segment in
    // isolation -- the danger is real, not hypothetical.
    expect(outerContourWallId(resolvedWalls, "in-bottom-left", "out-bottom")).toBe("out-bottom");

    const { walls: after, applied, diagnostics } = retargetWallThickness(
      walls,
      "in-bottom-left",
      35,
      resolvedWalls
    );

    expect(applied).toBe(true);
    expect(diagnostics).toEqual([]);
    // The T corner stays closed: both inner segments remain at the same offset.
    const left = after.find((w) => w.id === "in-bottom-left")!;
    const right = after.find((w) => w.id === "in-bottom-right")!;
    expect(left.innerLine[1]).toEqual(right.innerLine[0]);
    expect(left.innerLine[0].y).toBeCloseTo(right.innerLine[0].y);
    // The fallback moved the outer wall instead, exactly as the pre-fix default did.
    expect(after.find((w) => w.id === "out-bottom")!.innerLine[0].y).toBeCloseTo(-35);
    expect(left.innerLine[0].y).toBeCloseTo(0);
  });

  it("falls back to keeping the edited wall stationary before the contour has ever been computed (no layout yet)", () => {
    // Mid-drawing, or any edit made before the first compute: there is no
    // resolvedWalls to consult, so behavior is unchanged from before this rule.
    const before = pairedRoom(10).find((w) => w.id === "in-bottom")!;
    const { walls } = retargetWallThickness(pairedRoom(10), "in-bottom", 25, undefined);

    expect(walls.find((w) => w.id === "in-bottom")!.innerLine).toEqual(before.innerLine);
  });

  it("keeps a wall on the far side of the room -- sharing no corner with the edit -- completely unaffected", () => {
    // in-top shares no corner with in-bottom (opposite side of the
    // rectangle), unlike in-left/in-right which DO get re-mitred onto the
    // moved corner and legitimately change length as a result (see the
    // mixed-thickness test above). This isolates the fix's actual blast
    // radius: only the edited pair and their own immediate neighbours.
    const before = pairedRoom(10);
    const target = before.find((w) => w.id === "in-top")!;
    const resolvedWalls = resolveWalls(before).resolvedWalls;

    const { walls } = retargetWallThickness(before, "in-bottom", 25, resolvedWalls);
    const unrelated = walls.find((w) => w.id === "in-top")!;

    expect(unrelated.innerLine).toEqual(target.innerLine);
  });
});
