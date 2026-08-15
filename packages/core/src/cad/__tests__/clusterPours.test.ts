import { describe, expect, it } from "vitest";
import { clusterPours } from "../clusterPours.js";
import type { CadSegment } from "../segmentsToWalls.js";

/** A closed rectangle as four segments. */
function rect(x: number, y: number, w: number, h: number, layer = "0"): CadSegment[] {
  return [
    { x1: x, y1: y, x2: x + w, y2: y, layer },
    { x1: x + w, y1: y, x2: x + w, y2: y + h, layer },
    { x1: x + w, y1: y + h, x2: x, y2: y + h, layer },
    { x1: x, y1: y + h, x2: x, y2: y, layer },
  ];
}

describe("clusterPours", () => {
  it("keeps a nested pair of outlines together as one pour", () => {
    // The two faces of one wall ring: 20cm apart, so plainly one structure.
    const segments = [...rect(0, 0, 350, 440), ...rect(20, 20, 300, 400)];
    const groups = clusterPours(segments, "cm");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(8);
  });

  it("separates two pours drawn side by side on the same layer", () => {
    // Drawing1.dwg's shape: pour A at x 4769..5119, pour B at x 5577..5927.
    // Both on layer "0", so only the gap can tell them apart.
    const segments = [
      ...rect(4769, 3650, 350, 440),
      ...rect(4789, 3670, 300, 400),
      ...rect(5577, 3650, 350, 490),
      ...rect(5597, 3670, 300, 450),
    ];
    const groups = clusterPours(segments, "cm");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(8);
    expect(groups[1]).toHaveLength(8);
  });

  it("returns the biggest structure first", () => {
    const segments = [...rect(0, 0, 100, 100), ...rect(5000, 0, 400, 400), ...rect(5020, 20, 360, 360)];
    const groups = clusterPours(segments, "cm");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.length).toBeGreaterThan(groups[1]!.length);
  });

  it("merges clusters that a later segment bridges", () => {
    // Two rings far apart, then a wall joining them: one structure, not two.
    const segments = [
      ...rect(0, 0, 200, 200),
      ...rect(1000, 0, 200, 200),
      { x1: 200, y1: 100, x2: 1000, y2: 100, layer: "0" },
    ];
    expect(clusterPours(segments, "cm")).toHaveLength(1);
  });

  it("scales the separation threshold with the unit", () => {
    // 500 drawing units apart: two structures in cm, one in mm (50cm apart).
    const segments = [...rect(0, 0, 100, 100), ...rect(600, 0, 100, 100)];
    expect(clusterPours(segments, "cm")).toHaveLength(2);
    expect(clusterPours(segments, "mm")).toHaveLength(1);
  });

  it("handles an empty drawing", () => {
    expect(clusterPours([], "cm")).toEqual([]);
  });
});
