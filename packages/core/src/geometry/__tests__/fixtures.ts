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
