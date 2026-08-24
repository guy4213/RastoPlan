import { describe, expect, it } from "vitest";
import type { Point, Wall } from "@rastoplan/core";
import {
  displayedWallThickness,
  resolvedWallFrame,
  thicknessDimensionGroupKey,
  thicknessDimensionMode,
} from "./resolvedWallFrame.js";

/** A 400x300 room, traced clockwise, as a single contour with typed thickness. */
function room(): Wall[] {
  const w = (id: string, a: Point, b: Point): Wall => ({
    id,
    pourId: "pour-1",
    innerLine: [a, b],
    thickness: 20,
  });
  return [
    w("bottom", { x: 0, y: 0 }, { x: 400, y: 0 }),
    w("right", { x: 400, y: 0 }, { x: 400, y: 300 }),
    w("top", { x: 400, y: 300 }, { x: 0, y: 300 }),
    w("left", { x: 0, y: 300 }, { x: 0, y: 0 }),
  ];
}

/** Where the far face lands for this wall, at its midpoint. */
function farFaceMidpoint(wall: Wall, walls: Wall[]): Point {
  const frame = resolvedWallFrame(wall, undefined, walls);
  const [a, b] = wall.innerLine;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const push = frame.faceBOffsetCm * frame.outwardSign;

  return {
    x: (a.x + b.x) / 2 + ((b.y - a.y) / length) * push,
    y: (a.y + b.y) / 2 + ((a.x - b.x) / length) * push,
  };
}

const insideRoom = (p: Point) => p.x > 0 && p.x < 400 && p.y > 0 && p.y < 300;

describe("resolvedWallFrame — outward direction before any compute", () => {
  it("points every wall's far face out of the room", () => {
    // It used to be hard-coded to +1, whose direction depends only on which way
    // round the room was traced: on a rectangle two of the four walls put their
    // far face — and the length label that rides on it — INSIDE the room.
    for (const wall of room()) {
      expect(insideRoom(farFaceMidpoint(wall, room())), wall.id).toBe(false);
    }
  });

  it("gives the same answer whichever way round the room was traced", () => {
    const reversed = room().map((w) => ({
      ...w,
      innerLine: [w.innerLine[1], w.innerLine[0]] as [Point, Point],
    }));

    for (const wall of reversed) {
      expect(insideRoom(farFaceMidpoint(wall, reversed)), wall.id).toBe(false);
    }
  });

  it("survives a wall of zero length rather than dividing by zero", () => {
    const degenerate: Wall[] = [
      { id: "dot", pourId: "pour-1", innerLine: [{ x: 5, y: 5 }, { x: 5, y: 5 }], thickness: 20 },
    ];

    expect(resolvedWallFrame(degenerate[0]!, undefined, degenerate).outwardSign).toBe(1);
  });

  it("shows the measured gap of a preview pair before compute", () => {
    const near: Wall = {
      id: "near",
      pairedWallId: "far",
      pourId: "pour-1",
      innerLine: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
      ],
      // Deliberately different: preview must not overwrite the stored value.
      thickness: 20,
    };
    const far: Wall = {
      id: "far",
      pairedWallId: "near",
      pourId: "pour-1",
      innerLine: [
        { x: 420, y: -95 },
        { x: -20, y: -95 },
      ],
      thickness: 20,
    };
    const walls = [near, far];

    expect(resolvedWallFrame(near, undefined, walls).thickness).toBeCloseTo(95);
    expect(resolvedWallFrame(near, undefined, walls).faceBOffsetCm).toBeCloseTo(95);
    expect(displayedWallThickness(far, undefined, walls)).toBeCloseTo(95);
    expect(near.thickness).toBe(20);
    expect(far.thickness).toBe(20);
  });

  it("uses the declared thickness for a single contour before compute", () => {
    const wall = room()[0]!;
    expect(displayedWallThickness({ ...wall, thickness: 33 }, undefined, [wall])).toBe(33);
  });
});

describe("thickness dimension visibility", () => {
  it("keeps one static dimension visible for a paired wall even when none is selected", () => {
    expect(
      thicknessDimensionMode(
        { isConsumed: false, deferDimension: false, faceBIsDrawn: true, thicknessIsSet: true },
        false,
        true
      )
    ).toBe("static");
  });

  it("keeps lone-line thicknesses visible and makes the selected one interactive", () => {
    expect(
      thicknessDimensionMode(
        { isConsumed: false, deferDimension: false, faceBIsDrawn: false, thicknessIsSet: true },
        false,
        true
      )
    ).toBe("static");
    expect(
      thicknessDimensionMode(
        { isConsumed: false, deferDimension: false, faceBIsDrawn: false, thicknessIsSet: true },
        true,
        true
      )
    ).toBe("interactive");
  });

  it("hides the engine placeholder until a new line gets a real thickness", () => {
    expect(
      thicknessDimensionMode(
        { isConsumed: false, deferDimension: false, faceBIsDrawn: false, thicknessIsSet: false },
        true,
        true
      )
    ).toBe("hidden");
  });

  it("enables its grip only on the primary selected wall", () => {
    expect(
      thicknessDimensionMode(
        { isConsumed: false, deferDimension: false, faceBIsDrawn: true, thicknessIsSet: true },
        true,
        true
      )
    ).toBe("interactive");
    expect(
      thicknessDimensionMode(
        { isConsumed: false, deferDimension: false, faceBIsDrawn: true, thicknessIsSet: true },
        true,
        false
      )
    ).toBe("static");
  });

  it("hides duplicate dimensions on consumed or deferred partner contours", () => {
    expect(
      thicknessDimensionMode(
        { isConsumed: true, deferDimension: false, faceBIsDrawn: true, thicknessIsSet: true },
        false,
        true
      )
    ).toBe("hidden");
    expect(
      thicknessDimensionMode(
        { isConsumed: false, deferDimension: true, faceBIsDrawn: true, thicknessIsSet: true },
        false,
        true
      )
    ).toBe("hidden");
  });

  it("groups the two explicitly paired contours regardless of their direction", () => {
    const near: Wall = {
      id: "near",
      pourId: "pour-1",
      innerLine: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      thickness: 20,
      pairedWallId: "far",
    };
    const far: Wall = {
      id: "far",
      pourId: "pour-1",
      innerLine: [
        { x: 20, y: 80 },
        { x: 20, y: -20 },
      ],
      thickness: 20,
      pairedWallId: "near",
    };

    expect(thicknessDimensionGroupKey(near, { faceBOffsetCm: 20, outwardSign: 1 })).toBe(
      thicknessDimensionGroupKey(far, { faceBOffsetCm: 20, outwardSign: 1 })
    );
  });

  it("does not group separate unpaired walls even when they are parallel", () => {
    const first: Wall = {
      id: "first",
      pourId: "pour-1",
      innerLine: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      thickness: 20,
    };
    const second: Wall = {
      ...first,
      id: "second",
      innerLine: [
        { x: 40, y: 0 },
        { x: 40, y: 100 },
      ],
    };

    expect(thicknessDimensionGroupKey(first, { faceBOffsetCm: 20, outwardSign: 1 })).not.toBe(
      thicknessDimensionGroupKey(second, { faceBOffsetCm: 20, outwardSign: 1 })
    );
  });
});
