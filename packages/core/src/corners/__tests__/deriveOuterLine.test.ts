import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import { deriveOuterLine } from "../deriveOuterLine.js";

function wall(a: [number, number], b: [number, number], thickness: number): Wall {
  return {
    id: "w",
    pourId: "p",
    innerLine: [
      { x: a[0], y: a[1] },
      { x: b[0], y: b[1] },
    ],
    thickness,
  };
}

describe("deriveOuterLine", () => {
  it("offsets to the right of A→B by thickness (default side=+1)", () => {
    // Horizontal wall going east: right of A→B is south (y decreases).
    const outer = deriveOuterLine(wall([0, 0], [400, 0], 20));
    expect(outer[0]).toEqual({ x: 0, y: -20 });
    expect(outer[1]).toEqual({ x: 400, y: -20 });
  });

  it("side=-1 flips the offset to the left of A→B", () => {
    const outer = deriveOuterLine(wall([0, 0], [400, 0], 20), -1);
    expect(outer[0]).toEqual({ x: 0, y: 20 });
    expect(outer[1]).toEqual({ x: 400, y: 20 });
  });

  it("keeps the outer line parallel to the inner line (same length, perpendicular gap)", () => {
    const w = wall([10, 20], [310, 220], 15);
    const inner = w.innerLine;
    const outer = deriveOuterLine(w);
    const innerLength = Math.hypot(inner[1].x - inner[0].x, inner[1].y - inner[0].y);
    const outerLength = Math.hypot(outer[1].x - outer[0].x, outer[1].y - outer[0].y);
    expect(outerLength).toBeCloseTo(innerLength, 6);
    expect(Math.hypot(outer[0].x - inner[0].x, outer[0].y - inner[0].y)).toBeCloseTo(15, 6);
    expect(Math.hypot(outer[1].x - inner[1].x, outer[1].y - inner[1].y)).toBeCloseTo(15, 6);
  });

  it("respects variable thickness per wall", () => {
    const thin = deriveOuterLine(wall([0, 0], [100, 0], 15));
    const thick = deriveOuterLine(wall([0, 0], [100, 0], 30));
    expect(thin[0].y).toBe(-15);
    expect(thick[0].y).toBe(-30);
  });

  it("zero-length wall returns a copy of the endpoints without dividing by zero", () => {
    const outer = deriveOuterLine(wall([5, 5], [5, 5], 20));
    expect(outer[0]).toEqual({ x: 5, y: 5 });
    expect(outer[1]).toEqual({ x: 5, y: 5 });
  });
});
