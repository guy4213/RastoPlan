import { describe, expect, it } from "vitest";
import type { Point } from "../../types.js";
import {
  angleBetweenDeg,
  interiorSamplePoint,
  isStrictlyInside,
  perpendicularDistance,
  pointInPolygon,
  polygonPerimeter,
  projectedOverlap,
  unitNormal,
} from "../polygon.js";

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

/** The L-shape whose centroid falls in the notch, not in the polygon. */
const lShape: Point[] = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 150 },
  { x: 200, y: 150 },
  { x: 200, y: 300 },
  { x: 0, y: 300 },
];

describe("pointInPolygon", () => {
  it("accepts interior points and rejects exterior ones", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
  });

  it("counts vertices and edges as inside", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, square)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 0 }, square)).toBe(true);
  });

  it("handles a ray passing exactly through a vertex", () => {
    expect(pointInPolygon({ x: 300, y: 150 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 300, y: 200 }, lShape)).toBe(false);
  });

  it("gives the same answer whichever way the ring is wound", () => {
    const reversed = [...square].reverse();
    expect(pointInPolygon({ x: 50, y: 50 }, reversed)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, reversed)).toBe(false);
  });
});

describe("interiorSamplePoint", () => {
  it("lands inside a concave ring whose centroid does not", () => {
    const centroid = { x: 200, y: 150 };
    expect(isStrictlyInside(centroid, lShape)).toBe(false);

    const sample = interiorSamplePoint(lShape);
    expect(sample).not.toBeNull();
    expect(isStrictlyInside(sample!, lShape)).toBe(true);
  });

  it("returns null for a degenerate ring", () => {
    expect(interiorSamplePoint([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe("angleBetweenDeg", () => {
  const along = (a: Point, b: Point): [Point, Point] => [a, b];

  it("reports anti-parallel segments as 180 regardless of draw order", () => {
    const a = along({ x: 0, y: 0 }, { x: 100, y: 0 });
    const b = along({ x: 100, y: 20 }, { x: 0, y: 20 });
    expect(angleBetweenDeg(a, b)).toBeCloseTo(180);
    expect(angleBetweenDeg(b, a)).toBeCloseTo(180);
  });

  it("reports same-direction segments as 0", () => {
    const a = along({ x: 0, y: 0 }, { x: 100, y: 0 });
    const b = along({ x: 0, y: 20 }, { x: 100, y: 20 });
    expect(angleBetweenDeg(a, b)).toBeCloseTo(0);
  });
});

describe("projectedOverlap", () => {
  const a: [Point, Point] = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
  ];

  it("clips the partner's projection to the reference segment", () => {
    expect(
      projectedOverlap(a, [
        { x: -50, y: 20 },
        { x: 200, y: 20 },
      ])
    ).toEqual([0, 200]);
  });

  it("returns null when the segments do not face each other at all", () => {
    expect(
      projectedOverlap(a, [
        { x: 500, y: 20 },
        { x: 600, y: 20 },
      ])
    ).toBeNull();
  });
});

describe("perpendicularDistance and unitNormal", () => {
  it("measures separation from the infinite line, not the segment", () => {
    const line: [Point, Point] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(perpendicularDistance({ x: 500, y: 20 }, line)).toBeCloseTo(20);
  });

  it("returns the (dy,-dx) perpendicular the canvas uses", () => {
    expect(unitNormal({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ x: 0, y: -1 });
  });
});

describe("polygonPerimeter", () => {
  it("sums the closing edge too", () => {
    expect(polygonPerimeter(square)).toBe(400);
  });
});
