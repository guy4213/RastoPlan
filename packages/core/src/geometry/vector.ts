import type { Point } from "../types.js";

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** 2D cross product (z-component) of two vectors — sign gives turn direction. */
export function cross2(v1: Point, v2: Point): number {
  return v1.x * v2.y - v1.y * v2.x;
}

/**
 * Signed polygon area via the shoelace formula. Sign encodes winding
 * direction (consistently, regardless of coordinate convention) — used to
 * tell convex vertices from reflex ones, not to measure area.
 */
export function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
