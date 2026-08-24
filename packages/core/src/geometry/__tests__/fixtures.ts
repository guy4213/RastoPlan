import type { Point, Wall } from "../../types.js";

function makeWall(id: string, a: Point, b: Point, thickness: number): Wall {
  return {
    id,
    pourId: "pour-1",
    innerLine: [a, b],
    thickness,
  };
}

/**
 * A plain 400x300 rectangular room, all walls 20cm thick, corners exactly
 * coincident. 4 walls, 4 convex ('outer') L corners.
 */
export function rectangleWalls(): Wall[] {
  return [
    makeWall("bottom", { x: 0, y: 0 }, { x: 400, y: 0 }, 20),
    makeWall("right", { x: 400, y: 0 }, { x: 400, y: 300 }, 20),
    makeWall("top", { x: 400, y: 300 }, { x: 0, y: 300 }, 20),
    makeWall("left", { x: 0, y: 300 }, { x: 0, y: 0 }, 20),
  ];
}

/**
 * The customer's calibration model: the same 400x300 box, but the bottom wall
 * is 30cm thick and the other three are 20cm. Built to show the outer-corner
 * overlap reacting to the NEIGHBOUR's thickness — the two corners touching the
 * bottom wall behave differently from the two that don't.
 */
export function rectangleWallsMixedThickness(): Wall[] {
  return [
    makeWall("bottom", { x: 0, y: 0 }, { x: 400, y: 0 }, 30),
    makeWall("right", { x: 400, y: 0 }, { x: 400, y: 300 }, 20),
    makeWall("top", { x: 400, y: 300 }, { x: 0, y: 300 }, 20),
    makeWall("left", { x: 0, y: 300 }, { x: 0, y: 0 }, 20),
  ];
}

/**
 * Same rectangle, but the bottom/right corner is deliberately off by ~1.1cm
 * (within the 2cm snap tolerance) to prove buildGraph actually snaps rather
 * than relying on exact coordinate equality.
 */
export function rectangleWallsWithJitter(): Wall[] {
  return [
    makeWall("bottom", { x: 0, y: 0 }, { x: 401, y: 0.5 }, 20),
    makeWall("right", { x: 400, y: 0 }, { x: 400, y: 300 }, 20),
    makeWall("top", { x: 400, y: 300 }, { x: 0, y: 300 }, 20),
    makeWall("left", { x: 0, y: 300 }, { x: 0, y: 0 }, 20),
  ];
}

/**
 * An L-shaped hexagonal room: the full 400x300 rectangle with a 200x150
 * notch removed from the top-right corner. 6 walls, 6 L corners — exactly
 * one (at (200,150), the notch) is concave ('inner'); the other 5 are
 * convex ('outer').
 */
export function lShapeWalls(): Wall[] {
  const thickness = 20;
  return [
    makeWall("w1", { x: 0, y: 0 }, { x: 400, y: 0 }, thickness),
    makeWall("w2", { x: 400, y: 0 }, { x: 400, y: 150 }, thickness),
    makeWall("w3", { x: 400, y: 150 }, { x: 200, y: 150 }, thickness),
    makeWall("w4", { x: 200, y: 150 }, { x: 200, y: 300 }, thickness),
    makeWall("w5", { x: 200, y: 300 }, { x: 0, y: 300 }, thickness),
    makeWall("w6", { x: 0, y: 300 }, { x: 0, y: 0 }, thickness),
  ];
}

/**
 * A "through" wall split into two collinear halves plus a perpendicular
 * partition wall, all three sharing one endpoint at (200,0) — a T junction.
 */
export function tJunctionWalls(): Wall[] {
  return [
    makeWall("through-left", { x: 0, y: 0 }, { x: 200, y: 0 }, 20),
    makeWall("through-right", { x: 200, y: 0 }, { x: 400, y: 0 }, 20),
    makeWall("partition", { x: 200, y: 0 }, { x: 200, y: 150 }, 20),
  ];
}

/**
 * THE CUSTOMER'S DRAWING. The same 400x300 room, but traced the way it appears
 * in AutoCAD: an inner rectangle AND an outer rectangle 20cm out, both drawn as
 * walls. 8 walls, two disconnected components, one physical wall ring.
 */
export function doubleContourRoomWalls(): Wall[] {
  return [
    makeWall("in-bottom", { x: 0, y: 0 }, { x: 400, y: 0 }, 20),
    makeWall("in-right", { x: 400, y: 0 }, { x: 400, y: 300 }, 20),
    makeWall("in-top", { x: 400, y: 300 }, { x: 0, y: 300 }, 20),
    makeWall("in-left", { x: 0, y: 300 }, { x: 0, y: 0 }, 20),
    makeWall("out-bottom", { x: -20, y: -20 }, { x: 420, y: -20 }, 20),
    makeWall("out-right", { x: 420, y: -20 }, { x: 420, y: 320 }, 20),
    makeWall("out-top", { x: 420, y: 320 }, { x: -20, y: 320 }, 20),
    makeWall("out-left", { x: -20, y: 320 }, { x: -20, y: -20 }, 20),
  ];
}

/**
 * The same 400x300 room traced as two contours, at any thickness. The whole
 * point of the wall-thickness work is that nothing about the result should
 * depend on how close the two contours are, so every thickness case is one
 * call to this rather than a hand-written fixture per width.
 */
export function doubleContourRoomWallsAt(thicknessCm: number): Wall[] {
  const t = thicknessCm;
  return [
    makeWall("in-bottom", { x: 0, y: 0 }, { x: 400, y: 0 }, t),
    makeWall("in-right", { x: 400, y: 0 }, { x: 400, y: 300 }, t),
    makeWall("in-top", { x: 400, y: 300 }, { x: 0, y: 300 }, t),
    makeWall("in-left", { x: 0, y: 300 }, { x: 0, y: 0 }, t),
    makeWall("out-bottom", { x: -t, y: -t }, { x: 400 + t, y: -t }, t),
    makeWall("out-right", { x: 400 + t, y: -t }, { x: 400 + t, y: 300 + t }, t),
    makeWall("out-top", { x: 400 + t, y: 300 + t }, { x: -t, y: 300 + t }, t),
    makeWall("out-left", { x: -t, y: 300 + t }, { x: -t, y: -t }, t),
  ];
}

/** rectangleWalls() at an arbitrary thickness, the single-contour counterpart. */
export function rectangleWallsAt(thicknessCm: number): Wall[] {
  return rectangleWalls().map((w) => ({ ...w, thickness: thicknessCm }));
}

/**
 * The same drawing with two of the eight walls dragged the other way. The
 * resolved outward direction must come out identical — this is the regression
 * fixture for the outward sign having been read off each wall's own A→B drag
 * direction instead of the loop it belongs to.
 */
export function doubleContourRoomWallsMixedDirection(): Wall[] {
  return doubleContourRoomWalls().map((wall) =>
    wall.id === "in-top" || wall.id === "out-right"
      ? { ...wall, innerLine: [wall.innerLine[1], wall.innerLine[0]] as [Point, Point] }
      : wall
  );
}

/**
 * A 400x300 room split by a full-height partition at x=200. The perimeter is
 * split at the two T junctions so the graph has real nodes there: 6 perimeter
 * segments + 1 partition. Two room regions, 4 L corners, 2 T nodes.
 */
export function roomWithInteriorWallWalls(): Wall[] {
  return [
    makeWall("bottom-left", { x: 0, y: 0 }, { x: 200, y: 0 }, 20),
    makeWall("bottom-right", { x: 200, y: 0 }, { x: 400, y: 0 }, 20),
    makeWall("right", { x: 400, y: 0 }, { x: 400, y: 300 }, 20),
    makeWall("top-right", { x: 400, y: 300 }, { x: 200, y: 300 }, 20),
    makeWall("top-left", { x: 200, y: 300 }, { x: 0, y: 300 }, 20),
    makeWall("left", { x: 0, y: 300 }, { x: 0, y: 0 }, 20),
    makeWall("partition", { x: 200, y: 0 }, { x: 200, y: 300 }, 20),
  ];
}

/**
 * The 400x300 room with its bottom wall drawn 3px off level — what a hand
 * traced plan actually looks like. Every wall length here is irrational.
 */
export function slightlySkewedRoomWalls(): Wall[] {
  return [
    makeWall("bottom", { x: 0, y: 3 }, { x: 400, y: 0 }, 20),
    makeWall("right", { x: 400, y: 0 }, { x: 400, y: 300 }, 20),
    makeWall("top", { x: 400, y: 300 }, { x: 0, y: 300 }, 20),
    makeWall("left", { x: 0, y: 300 }, { x: 0, y: 3 }, 20),
  ];
}

/**
 * A 600x300 room split by an L-shaped partition, so the partition has a real
 * corner at (300,150) with a room on BOTH sides. That corner is convex for the
 * small room and concave for the large one — one physical corner, two corner
 * panels, and no overlap strip anywhere on it.
 */
export function lShapedPartitionWalls(): Wall[] {
  return [
    makeWall("p1", { x: 0, y: 0 }, { x: 300, y: 0 }, 20),
    makeWall("p2", { x: 300, y: 0 }, { x: 600, y: 0 }, 20),
    makeWall("p3", { x: 600, y: 0 }, { x: 600, y: 150 }, 20),
    makeWall("p4", { x: 600, y: 150 }, { x: 600, y: 300 }, 20),
    makeWall("p5", { x: 600, y: 300 }, { x: 0, y: 300 }, 20),
    makeWall("p6", { x: 0, y: 300 }, { x: 0, y: 0 }, 20),
    makeWall("q1", { x: 300, y: 0 }, { x: 300, y: 150 }, 20),
    makeWall("q2", { x: 300, y: 150 }, { x: 600, y: 150 }, 20),
  ];
}

/**
 * rectangleWalls() with the bottom wall drawn as two collinear halves — the
 * natural result of retracing a plan segment by segment. (200,0) is a straight
 * join, NOT a corner: it must consume no corner panel and no corner clamps.
 */
export function collinearSplitWallWalls(): Wall[] {
  return [
    makeWall("bottom-left", { x: 0, y: 0 }, { x: 200, y: 0 }, 20),
    makeWall("bottom-right", { x: 200, y: 0 }, { x: 400, y: 0 }, 20),
    makeWall("right", { x: 400, y: 0 }, { x: 400, y: 300 }, 20),
    makeWall("top", { x: 400, y: 300 }, { x: 0, y: 300 }, 20),
    makeWall("left", { x: 0, y: 300 }, { x: 0, y: 0 }, 20),
  ];
}

/**
 * The L-shape drawn as two contours 20cm apart — exercises pairing around the
 * concave notch, where the outer contour's corresponding vertex sits 20*sqrt(2)
 * away rather than 20.
 */
export function doubleContourLShapeWalls(): Wall[] {
  const inner: Point[] = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 150 },
    { x: 200, y: 150 },
    { x: 200, y: 300 },
    { x: 0, y: 300 },
  ];
  const outer: Point[] = [
    { x: -20, y: -20 },
    { x: 420, y: -20 },
    { x: 420, y: 170 },
    { x: 220, y: 170 },
    { x: 220, y: 320 },
    { x: -20, y: 320 },
  ];
  const ring = (points: Point[], prefix: string) =>
    points.map((p, i) => makeWall(`${prefix}-${i}`, p, points[(i + 1) % points.length]!, 20));
  return [...ring(inner, "in"), ...ring(outer, "out")];
}

/**
 * A 1000x800 hall with a free-standing 300x200 room inside it, ~300cm clear all
 * round. The two contours are nested but must NOT pair into a wall ring — this
 * is what proves the plausible-thickness band actually gates the heuristic.
 */
export function nestedRoomsWalls(): Wall[] {
  const ring = (a: Point, b: Point, prefix: string) =>
    [
      makeWall(`${prefix}-bottom`, { x: a.x, y: a.y }, { x: b.x, y: a.y }, 20),
      makeWall(`${prefix}-right`, { x: b.x, y: a.y }, { x: b.x, y: b.y }, 20),
      makeWall(`${prefix}-top`, { x: b.x, y: b.y }, { x: a.x, y: b.y }, 20),
      makeWall(`${prefix}-left`, { x: a.x, y: b.y }, { x: a.x, y: a.y }, 20),
    ];
  return [
    ...ring({ x: 0, y: 0 }, { x: 1000, y: 800 }, "hall"),
    ...ring({ x: 350, y: 300 }, { x: 650, y: 500 }, "room"),
  ];
}

/**
 * TWO POURS. Two separate rooms, each traced the way the customer draws — an
 * inner contour and an outer one — and each assigned to its own pour, at a
 * DIFFERENT wall thickness. The second uses 10cm, the width that used to fall
 * under the old plausible-thickness floor and come back doubled.
 *
 * Placed far enough apart that neither plan's geometry can reach the other, so
 * anything that leaks between the two pours is a bookkeeping bug rather than a
 * consequence of the drawing.
 */
export function twoPourDoubleContourWalls(): Wall[] {
  const ring = (
    origin: Point,
    size: Point,
    thickness: number,
    pourId: string,
    prefix: string
  ): Wall[] => {
    const t = thickness;
    const corners = (inset: number): Point[] => [
      { x: origin.x - inset, y: origin.y - inset },
      { x: origin.x + size.x + inset, y: origin.y - inset },
      { x: origin.x + size.x + inset, y: origin.y + size.y + inset },
      { x: origin.x - inset, y: origin.y + size.y + inset },
    ];

    return [
      ...contour(corners(0), `${prefix}-in`),
      ...contour(corners(t), `${prefix}-out`),
    ];

    function contour(points: Point[], name: string): Wall[] {
      return points.map((p, i) => ({
        id: `${name}-${i}`,
        pourId,
        innerLine: [p, points[(i + 1) % points.length]!] as [Point, Point],
        thickness: t,
      }));
    }
  };

  return [
    ...ring({ x: 0, y: 0 }, { x: 400, y: 300 }, 20, "pour-1", "a"),
    ...ring({ x: 1000, y: 0 }, { x: 300, y: 200 }, 10, "pour-2", "b"),
  ];
}
