import { describe, expect, it } from "vitest";
import { pourLabelAnchors } from "../pourLabelAnchors.js";
import type { Pour, Wall } from "../../types.js";

function wall(id: string, pourId: string, a: [number, number], b: [number, number]): Wall {
  return {
    id,
    pourId,
    innerLine: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }],
    thickness: 20,
    thicknessSet: true,
  };
}

function pour(id: string, name: string, order: number): Pour {
  return { id, name, color: "#000000", order };
}

describe("pourLabelAnchors", () => {
  it("returns [] for no walls or no pours", () => {
    expect(pourLabelAnchors([], [pour("p1", "יציקה 1", 0)])).toEqual([]);
    expect(pourLabelAnchors([wall("w1", "p1", [0, 0], [100, 0])], [])).toEqual([]);
  });

  it("places the anchor at the length-weighted centroid of a rectangle's wall midpoints", () => {
    // A 100x50 rectangle. Each wall's midpoint sits on the rectangle's own
    // edge midpoint; by symmetry the weighted centroid lands on the
    // rectangle's true centre regardless of the length weighting.
    const walls: Wall[] = [
      wall("w1", "p1", [0, 0], [100, 0]),
      wall("w2", "p1", [100, 0], [100, 50]),
      wall("w3", "p1", [100, 50], [0, 50]),
      wall("w4", "p1", [0, 50], [0, 0]),
    ];
    const pours = [pour("p1", "יציקה 1", 0)];
    const anchors = pourLabelAnchors(walls, pours);

    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.pourId).toBe("p1");
    expect(anchors[0]!.name).toBe("יציקה 1");
    expect(anchors[0]!.point.x).toBeCloseTo(50, 5);
    expect(anchors[0]!.point.y).toBeCloseTo(25, 5);
    expect(anchors[0]!.wallIds).toEqual(["w1", "w2", "w3", "w4"]);
  });

  it("gives a pour two anchors when its walls form two disconnected groups", () => {
    const walls: Wall[] = [
      // Group A: a short wall near the origin.
      wall("w1", "p1", [0, 0], [100, 0]),
      // Group B: a separate, far-away wall — no shared endpoint with group A.
      wall("w2", "p1", [1000, 1000], [1100, 1000]),
    ];
    const pours = [pour("p1", "יציקה 1", 0)];
    const anchors = pourLabelAnchors(walls, pours);

    expect(anchors).toHaveLength(2);
    expect(anchors[0]!.wallIds).toEqual(["w1"]);
    expect(anchors[0]!.point).toEqual({ x: 50, y: 0 });
    expect(anchors[1]!.wallIds).toEqual(["w2"]);
    expect(anchors[1]!.point).toEqual({ x: 1050, y: 1000 });
  });

  it("keeps two pours separate even where their walls share a corner", () => {
    const walls: Wall[] = [
      wall("w1", "p1", [0, 0], [100, 0]),
      wall("w2", "p1", [100, 0], [100, 100]),
      // Shares the (100,100)-ish corner with p1's w2, but belongs to p2 — must
      // not merge into p1's group.
      wall("w3", "p2", [100, 100], [200, 100]),
    ];
    const pours = [pour("p1", "יציקה 1", 0), pour("p2", "יציקה 2", 1)];
    const anchors = pourLabelAnchors(walls, pours);

    expect(anchors).toHaveLength(2);
    const p1 = anchors.find((a) => a.pourId === "p1")!;
    const p2 = anchors.find((a) => a.pourId === "p2")!;
    expect(p1.wallIds).toEqual(["w1", "w2"]);
    expect(p2.wallIds).toEqual(["w3"]);
  });

  it("orders anchors by the given pours order, then by earliest wall within a pour", () => {
    const walls: Wall[] = [
      wall("wB", "p2", [500, 500], [600, 500]),
      wall("wA", "p1", [0, 0], [100, 0]),
    ];
    // p2 listed before p1 in `pours` — output must follow that order.
    const pours = [pour("p2", "יציקה 2", 0), pour("p1", "יציקה 1", 1)];
    const anchors = pourLabelAnchors(walls, pours);

    expect(anchors.map((a) => a.pourId)).toEqual(["p2", "p1"]);
  });

  it("ignores walls whose pourId does not match any given pour", () => {
    const walls: Wall[] = [wall("w1", "ghost-pour", [0, 0], [100, 0])];
    const anchors = pourLabelAnchors(walls, [pour("p1", "יציקה 1", 0)]);
    expect(anchors).toEqual([]);
  });

  it("snaps near-coincident endpoints (within SNAP_TOLERANCE_CM) into one group", () => {
    const walls: Wall[] = [
      wall("w1", "p1", [0, 0], [100, 0]),
      // Endpoint is 1cm off from (100, 0) — within the engine's 2cm snap.
      wall("w2", "p1", [101, 0], [101, 100]),
    ];
    const anchors = pourLabelAnchors(walls, [pour("p1", "יציקה 1", 0)]);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.wallIds).toEqual(["w1", "w2"]);
  });
});
