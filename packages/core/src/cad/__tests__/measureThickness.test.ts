import { describe, expect, it } from "vitest";
import { measureThickness } from "../measureThickness.js";
import type { Wall } from "../../types.js";

let n = 0;
function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pourId = "p1",
  thickness = 20
): Wall {
  return {
    id: `w${n++}`,
    pourId,
    innerLine: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
    thickness,
  };
}

/** Two nested rectangles: outer 350x440, inner offset by the given gaps. */
function ring(left: number, right: number, bottom: number, top: number, pourId = "p1"): Wall[] {
  return [
    // outer
    wall(0, 0, 0, 440, pourId),
    wall(0, 440, 350, 440, pourId),
    wall(350, 440, 350, 0, pourId),
    wall(350, 0, 0, 0, pourId),
    // inner
    wall(left, bottom, left, 440 - top, pourId),
    wall(left, 440 - top, 350 - right, 440 - top, pourId),
    wall(350 - right, 440 - top, 350 - right, bottom, pourId),
    wall(350 - right, bottom, left, bottom, pourId),
  ];
}

describe("measureThickness", () => {
  it("reads each wall's thickness off the facing contour", () => {
    const { walls, measured } = measureThickness(ring(20, 20, 20, 20));
    expect(measured).toBe(8);
    expect(walls.every((w) => w.thickness === 20)).toBe(true);
  });

  it("measures sides independently when they differ", () => {
    // Drawing1.dwg's pour A: 20cm on the left, 30cm on the right.
    const { walls } = measureThickness(ring(20, 30, 20, 20));
    const thicknesses = walls.map((w) => w.thickness).sort((a, b) => a - b);
    expect(thicknesses).toContain(30);
    expect(thicknesses.filter((t) => t === 20).length).toBeGreaterThan(0);
    // The left pair reads 20, the right pair reads 30.
    expect(walls[0]!.thickness).toBe(20);
    expect(walls[2]!.thickness).toBe(30);
  });

  it("leaves the incoming thickness when there is no facing face", () => {
    const lone = [wall(0, 0, 400, 0, "p1", 25)];
    const { walls, measured } = measureThickness(lone);
    expect(measured).toBe(0);
    expect(walls[0]!.thickness).toBe(25);
  });

  it("never measures one pour against another", () => {
    // Two pours 15cm apart — close enough to look like a wall if pours were
    // ignored, which would silently invent a 15cm wall across the gap.
    const a = ring(20, 20, 20, 20, "p1");
    const b = ring(20, 20, 20, 20, "p2").map((w) => ({
      ...w,
      innerLine: [
        { x: w.innerLine[0].x + 365, y: w.innerLine[0].y },
        { x: w.innerLine[1].x + 365, y: w.innerLine[1].y },
      ] as [{ x: number; y: number }, { x: number; y: number }],
    }));
    const { walls } = measureThickness([...a, ...b]);
    expect(walls.every((w) => w.thickness === 20)).toBe(true);
  });

  it("ignores a facing line too far away to be a wall", () => {
    // A 4m-wide room: the far wall is not this wall's other face.
    const room = [wall(0, 0, 500, 0), wall(0, 400, 500, 400)];
    const { measured } = measureThickness(room);
    expect(measured).toBe(0);
  });

  it("ignores a line that barely overlaps", () => {
    const walls = [wall(0, 0, 500, 0), wall(480, 20, 600, 20)];
    expect(measureThickness(walls).measured).toBe(0);
  });

  it("ignores lines that splay instead of running parallel", () => {
    const walls = [wall(0, 0, 500, 0), wall(0, 20, 500, 60)];
    expect(measureThickness(walls).measured).toBe(0);
  });
});
