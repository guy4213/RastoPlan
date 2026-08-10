import type { OutwardSign, Point, Wall } from "../types.js";

/**
 * Which perpendicular offset is "outer" relative to the wall's A→B direction.
 * The sign comes from `resolveWalls` (contours layer), which derives it from
 * the wall loop the edge belongs to. The +1 default is only for callers that
 * have no resolution yet — relying on it is what put outer bands inside rooms.
 */
export type OuterSide = OutwardSign;

/**
 * Derives a wall's outer face centerline as a line parallel to `innerLine`,
 * offset by `wall.thickness` in the direction selected by `side`.
 *
 * The inner line is the master; the outer line is never stored. Direction is
 * a caller responsibility because a bare Wall doesn't carry loop orientation
 * — the corners pipeline chooses the sign per wall from the graph.
 */
export function deriveOuterLine(wall: Wall, side: OuterSide = 1): [Point, Point] {
  const [a, b] = wall.innerLine;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [{ ...a }, { ...b }];

  // Unit perpendicular: right of A→B (side=+1) is (dy, -dx)/|len|; left is
  // the negation. Scale by wall thickness to place the outer centerline.
  const nx = (dy / length) * side;
  const ny = (-dx / length) * side;
  const offset = { x: nx * wall.thickness, y: ny * wall.thickness };

  return [
    { x: a.x + offset.x, y: a.y + offset.y },
    { x: b.x + offset.x, y: b.y + offset.y },
  ];
}
