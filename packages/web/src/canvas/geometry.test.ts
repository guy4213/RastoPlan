import { describe, expect, it } from "vitest";
import type { Wall } from "@rastoplan/core";
import {
  applyAxisLock,
  bandFromCorners,
  labelSideByWallId,
  panelOverlapRects,
  thicknessFromPointer,
  wallLabelPlacement,
} from "./geometry.js";

const start = { x: 0, y: 0 };

describe("applyAxisLock", () => {
  it("passes the point straight through when the lock is off", () => {
    expect(applyAxisLock(start, { x: 100, y: 40 }, false)).toEqual({ x: 100, y: 40 });
  });

  it("collapses to the horizontal when the drag is mostly horizontal", () => {
    expect(applyAxisLock(start, { x: 100, y: 40 }, true)).toEqual({ x: 100, y: 0 });
  });

  it("collapses to the vertical when the drag is mostly vertical", () => {
    expect(applyAxisLock(start, { x: 40, y: 100 }, true)).toEqual({ x: 0, y: 100 });
  });

  it("locks relative to the segment's own start, not the origin", () => {
    expect(applyAxisLock({ x: 200, y: 300 }, { x: 260, y: 305 }, true)).toEqual({ x: 260, y: 300 });
  });
});

describe("thicknessFromPointer", () => {
  // A horizontal wall along y=0; outwardSign +1 puts the far face at negative y.
  const wall: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
  ];
  const bounds = { minCm: 5, maxCm: 80, stepCm: 0.5 };

  it("reads the distance the pointer was dragged out to", () => {
    expect(thicknessFromPointer(wall, 1, { x: 200, y: -32 }, bounds)).toBe(32);
  });

  it("snaps to the step so a mouse cannot produce 32.3", () => {
    expect(thicknessFromPointer(wall, 1, { x: 200, y: -32.3 }, bounds)).toBe(32.5);
    expect(thicknessFromPointer(wall, 1, { x: 200, y: -32.1 }, bounds)).toBe(32);
  });

  it("ignores where along the wall the pointer is — only the perpendicular counts", () => {
    expect(thicknessFromPointer(wall, 1, { x: -900, y: -32 }, bounds)).toBe(32);
  });

  it("clamps instead of flipping when dragged through to the inner side", () => {
    // Past the wall and out the other side. Taking the absolute distance here
    // would turn the far face inside out and read as a growing wall.
    expect(thicknessFromPointer(wall, 1, { x: 200, y: 40 }, bounds)).toBe(5);
  });

  it("clamps to the bounds at both ends", () => {
    expect(thicknessFromPointer(wall, 1, { x: 200, y: -500 }, bounds)).toBe(80);
    expect(thicknessFromPointer(wall, 1, { x: 200, y: -1 }, bounds)).toBe(5);
  });

  it("follows the resolved outward sign on a wall drawn the other way round", () => {
    expect(thicknessFromPointer(wall, -1, { x: 200, y: 32 }, bounds)).toBe(32);
    expect(thicknessFromPointer(wall, -1, { x: 200, y: -32 }, bounds)).toBe(5);
  });

  it("works on a diagonal wall", () => {
    const diagonal: typeof wall = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    // 20cm along the outward normal of a 45° wall.
    const off = 20 / Math.SQRT2;
    expect(thicknessFromPointer(diagonal, 1, { x: 50 + off, y: 50 - off }, bounds)).toBe(20);
  });

  it("returns the minimum for a zero-length wall rather than dividing by zero", () => {
    const degenerate: typeof wall = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(thicknessFromPointer(degenerate, 1, { x: 50, y: 50 }, bounds)).toBe(5);
  });
});

describe("labelSideByWallId", () => {
  const ring = (x0: number, y0: number, x1: number, y1: number, prefix: string): Wall[] => {
    const pts = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
    return pts.map((p, i) => ({
      id: `${prefix}-${i}`,
      pourId: "pour-1",
      innerLine: [p, pts[(i + 1) % pts.length]!] as [Wall["innerLine"][0], Wall["innerLine"][1]],
      thickness: 20,
    }));
  };

  /** Where the label lands, 30cm off the wall on the side the map picked. */
  function labelAt(wall: Wall, side: 1 | -1) {
    const [a, b] = wall.innerLine;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const push = 30 * side;
    return {
      x: (a.x + b.x) / 2 + ((b.y - a.y) / length) * push,
      y: (a.y + b.y) / 2 + ((a.x - b.x) / length) * push,
    };
  }

  const inside = (p: { x: number; y: number }, x0: number, y0: number, x1: number, y1: number) =>
    p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1;

  it("puts every label outside the room", () => {
    const walls = ring(0, 0, 400, 300, "w");
    const sides = labelSideByWallId(walls);

    for (const wall of walls) {
      expect(inside(labelAt(wall, sides.get(wall.id)!), 0, 0, 400, 300), wall.id).toBe(false);
    }
  });

  it("does not care which way round the room was traced", () => {
    const walls = ring(0, 0, 400, 300, "w").map((w) => ({
      ...w,
      innerLine: [w.innerLine[1], w.innerLine[0]] as [Wall["innerLine"][0], Wall["innerLine"][1]],
    }));
    const sides = labelSideByWallId(walls);

    for (const wall of walls) {
      expect(inside(labelAt(wall, sides.get(wall.id)!), 0, 0, 400, 300), wall.id).toBe(false);
    }
  });

  it("works ring by ring on a room drawn inside another room", () => {
    // The reported case. Judged per ring, so the inner room's labels land in
    // the gap between the two rather than being flung past the outer wall —
    // and, crucially, the outer room's labels do not end up inside it.
    const outer = ring(0, 0, 800, 600, "out");
    const inner = ring(200, 150, 600, 450, "in");
    const sides = labelSideByWallId([...outer, ...inner]);

    for (const wall of outer) {
      expect(inside(labelAt(wall, sides.get(wall.id)!), 0, 0, 800, 600), wall.id).toBe(false);
    }
    for (const wall of inner) {
      const at = labelAt(wall, sides.get(wall.id)!);
      expect(inside(at, 200, 150, 600, 450), wall.id).toBe(false);
      // ...and still within the outer room, i.e. in the gap.
      expect(inside(at, 0, 0, 800, 600), wall.id).toBe(true);
    }
  });
});

describe("wallLabelPlacement", () => {
  const wall = (a: { x: number; y: number }, b: { x: number; y: number }): Wall => ({
    id: "w",
    pourId: "pour-1",
    innerLine: [a, b],
    thickness: 20,
  });

  const ring = (x0: number, y0: number, x1: number, y1: number): Wall[] => {
    const pts = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
    return pts.map((p, i) => ({
      ...wall(p, pts[(i + 1) % pts.length]!),
      id: `w${i}`,
    }));
  };

  it("lands on the side it was given, for all four orientations", () => {
    // Right, down, left, up. The label must sit above/left of the line in the
    // (dy,-dx) frame for side -1 and below/right for +1 — every time.
    const cases: Array<[Wall, 1 | -1, { x: number; y: number }]> = [
      [wall({ x: 0, y: 0 }, { x: 100, y: 0 }), 1, { x: 50, y: -30 }],
      [wall({ x: 0, y: 0 }, { x: 0, y: 100 }), 1, { x: 30, y: 50 }],
      [wall({ x: 100, y: 0 }, { x: 0, y: 0 }), 1, { x: 50, y: 30 }],
      [wall({ x: 0, y: 100 }, { x: 0, y: 0 }), 1, { x: -30, y: 50 }],
    ];

    for (const [w, side, expected] of cases) {
      const at = wallLabelPlacement(w, side, 30)!;
      expect({ x: Math.round(at.x), y: Math.round(at.y) }).toEqual(expected);
    }
  });

  it("keeps the text upright without moving it to the other side", () => {
    // A wall pointing left reads upside down, so the rotation flips. That flip
    // used to negate the offset too, which put the label on the far side of the
    // wall — on a room, inside it.
    const rightward = wallLabelPlacement(wall({ x: 0, y: 0 }, { x: 100, y: 0 }), 1, 30)!;
    const leftward = wallLabelPlacement(wall({ x: 100, y: 0 }, { x: 0, y: 0 }), -1, 30)!;

    expect(rightward.rotationDeg).toBe(0);
    expect(leftward.rotationDeg).toBe(0);
    // Same side of the same line, whichever way it was drawn.
    expect(Math.round(leftward.y)).toBe(Math.round(rightward.y));
  });

  it("puts every label of a room outside it, horizontals included", () => {
    // The reported failure: the vertical walls came out right and the top and
    // bottom ones sat inside the room.
    const walls = ring(0, 0, 400, 300);
    const sides = labelSideByWallId(walls);

    for (const w of walls) {
      const at = wallLabelPlacement(w, sides.get(w.id)!, 30)!;
      const inside = at.x > 0 && at.x < 400 && at.y > 0 && at.y < 300;
      expect(inside, w.id).toBe(false);
    }
  });

  it("returns nothing for a wall too short to label", () => {
    expect(wallLabelPlacement(wall({ x: 0, y: 0 }, { x: 0.5, y: 0 }), 1, 30)).toBeNull();
  });
});

describe("length labels on a room traced inside another room", () => {
  // Outer 499 x 390, inner 280 x 200, centred — the reported drawing. The
  // engine resolves the two rings as one 95/109.5cm wall, which is exactly the
  // case that used to fling every label a metre out, over the next ring.
  const ring = (x0: number, y0: number, x1: number, y1: number, prefix: string): Wall[] => {
    const pts = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
    return pts.map((p, i) => ({
      id: `${prefix}-${i}`,
      pourId: "pour-1",
      innerLine: [p, pts[(i + 1) % pts.length]!] as [Wall["innerLine"][0], Wall["innerLine"][1]],
      // Whatever the engine measured between the rings ends up here.
      thickness: 95,
    }));
  };

  const outer = ring(0, 0, 499, 390, "out");
  const inner = ring(109.5, 95, 389.5, 295, "in");
  const walls = [...outer, ...inner];

  /** A label offset of 20 screen pixels at a scale that fits the plan. */
  const offsetCm = 20 / 1.1;

  it("keeps every label within a hand's width of its own wall", () => {
    const sides = labelSideByWallId(walls);

    for (const wall of walls) {
      const at = wallLabelPlacement(wall, sides.get(wall.id)!, offsetCm)!;
      const [a, b] = wall.innerLine;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const distance = Math.abs((b.x - a.x) * (at.y - a.y) - (b.y - a.y) * (at.x - a.x)) / length;

      // Not 100cm away on the far side of the next ring.
      expect(distance, wall.id).toBeLessThan(30);
    }
  });

  it("still puts the inner ring's labels in the gap, not inside it", () => {
    const sides = labelSideByWallId(walls);
    const insideInner = (p: { x: number; y: number }) =>
      p.x > 109.5 && p.x < 389.5 && p.y > 95 && p.y < 295;

    for (const wall of inner) {
      const at = wallLabelPlacement(wall, sides.get(wall.id)!, offsetCm)!;
      expect(insideInner(at), wall.id).toBe(false);
    }
  });

  it("never lets one ring's label land on the other ring's wall", () => {
    const sides = labelSideByWallId(walls);
    const near = (p: { x: number; y: number }, wall: Wall) => {
      const [a, b] = wall.innerLine;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length < 5;
    };

    for (const wall of inner) {
      const at = wallLabelPlacement(wall, sides.get(wall.id)!, offsetCm)!;
      for (const other of outer) expect(near(at, other), `${wall.id} vs ${other.id}`).toBe(false);
    }
  });
});

describe("panelOverlapRects", () => {
  const band = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

  it("finds the corner joint between two walls", () => {
    // The measured numbers from the reported plan: the horizontal wall's last
    // panel and the vertical wall's first one.
    const rects = panelOverlapRects([
      { edgeId: "edge:in-0", band: band(426.5, -8, 501.5, 0) },
      { edgeId: "edge:in-1", band: band(499, -2, 507, 83) },
    ]);

    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x0: 499, y0: -2, x1: 501.5, y1: 0 });
  });

  it("ignores panels butting along the same wall", () => {
    // Neighbours on one run share an edge and are not a joint.
    const rects = panelOverlapRects([
      { edgeId: "edge:w", band: band(0, 0, 75, 8) },
      { edgeId: "edge:w", band: band(74, 0, 149, 8) },
    ]);

    expect(rects).toEqual([]);
  });

  it("reports nothing when two walls only touch along an edge", () => {
    // Exactly the failure the lap exists to remove: the bands meet at a line,
    // so there is no joint at all.
    const rects = panelOverlapRects([
      { edgeId: "edge:a", band: band(0, -8, 420, 0) },
      { edgeId: "edge:b", band: band(420, 0, 428, 300) },
    ]);

    expect(rects).toEqual([]);
  });
});
