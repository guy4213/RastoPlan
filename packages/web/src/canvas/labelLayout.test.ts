import { describe, expect, it } from "vitest";
import type { Point } from "@rastoplan/core";
import { layoutLabels, type LabelCandidate } from "./labelLayout.js";

/** Same estimate labelLayout.ts uses internally, kept in the test so an
 * assertion about "no overlap" is checking the same metric the solver acts
 * on rather than a hand-rolled second guess of it. */
function estimatedHalfExtents(text: string, fontSizeCm: number): { halfWidth: number; halfHeight: number } {
  return {
    halfWidth: (Math.max(1, text.length) * fontSizeCm * 0.6) / 2,
    halfHeight: (fontSizeCm * 1.2) / 2,
  };
}

/** Axis-aligned bounds of the placed label's (possibly rotated) box, using
 * the same rectangle math as labelLayout.ts, so overlap can be re-checked
 * independently of the internals under test. */
function boundsOf(center: Point, rotationDeg: number, text: string, fontSizeCm: number) {
  const { halfWidth, halfHeight } = estimatedHalfExtents(text, fontSizeCm);
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local: Array<[number, number]> = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ];
  const corners: Point[] = local.map(([lx, ly]) => ({
    x: center.x + lx * cos - ly * sin,
    y: center.y + lx * sin + ly * cos,
  }));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function boxesOverlap(a: ReturnType<typeof boundsOf>, b: ReturnType<typeof boundsOf>): boolean {
  return a.x0 < b.x1 - 0.01 && a.x1 > b.x0 + 0.01 && a.y0 < b.y1 - 0.01 && a.y1 > b.y0 + 0.01;
}

describe("layoutLabels", () => {
  it("does not move a lone label at all", () => {
    const candidate: LabelCandidate = {
      id: "len:w1",
      anchor: { x: 100, y: 50 },
      rotationDeg: 0,
      text: '546 ס"מ',
      fontSizeCm: 6,
      pushDir: { x: 0, y: 1 },
      priority: 1_000_546,
    };
    const result = layoutLabels([candidate]);
    expect(result.get("len:w1")).toEqual({ x: 100, y: 50, rotationDeg: 0 });
  });

  it("separates a wall's length label from its thickness label in the two-contour collision case", () => {
    // Mirrors the reported bug: a 20cm-thick wall zoomed in to roughly
    // scale ~= 2, where the old thickness/2 anchor (10cm out) landed right
    // on top of the length label's fixed 20px/scale (also 10cm) offset.
    const scale = 2;
    const wallLengthCm = 546;
    const thicknessCm = 20;

    // Wall runs along +x; its normal (0,-1) points "up" on screen, the
    // direction both labels are pushed toward in the real component.
    const lengthLabelAnchor = { x: wallLengthCm / 2, y: -(20 / scale) };
    // The paired inner-contour wall's own length label, on the SAME side —
    // the "two numbers side by side" half of the reported bug.
    const innerLengthLabelAnchor = { x: (wallLengthCm - 2 * thicknessCm) / 2, y: -(20 / scale) - 3 };
    // Old bug site: thickness/2 out. We feed the solver the post-fix anchor
    // (beyond the full thickness, see Walls.tsx THICKNESS_LABEL_MARGIN_PIXELS)
    // to prove the solver keeps it separated from BOTH length labels, not
    // just the one it was originally colliding with.
    const thicknessLabelAnchor = { x: wallLengthCm / 2, y: -(thicknessCm + 14 / scale) };

    const candidates: LabelCandidate[] = [
      {
        id: "len:outer",
        anchor: lengthLabelAnchor,
        rotationDeg: 0,
        text: '546 ס"מ',
        fontSizeCm: 12 / scale,
        pushDir: { x: 0, y: -1 },
        priority: 1_000_000 + wallLengthCm,
      },
      {
        id: "len:inner",
        anchor: innerLengthLabelAnchor,
        rotationDeg: 0,
        text: '506 ס"מ',
        fontSizeCm: 12 / scale,
        pushDir: { x: 0, y: -1 },
        priority: 1_000_000 + (wallLengthCm - 2 * thicknessCm),
      },
      {
        id: "thk:outer",
        anchor: thicknessLabelAnchor,
        rotationDeg: 0,
        text: '20 ס"מ',
        fontSizeCm: 10 / scale,
        pushDir: { x: 0, y: -1 },
        priority: wallLengthCm,
      },
    ];

    const result = layoutLabels(candidates);
    expect(result.size).toBe(3);

    const boxes = candidates.map((c) => {
      const placed = result.get(c.id)!;
      return boundsOf({ x: placed.x, y: placed.y }, placed.rotationDeg, c.text, c.fontSizeCm);
    });

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(boxesOverlap(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });

  it("is deterministic: identical input produces identical output", () => {
    const candidates: LabelCandidate[] = [
      {
        id: "b",
        anchor: { x: 10, y: 10 },
        rotationDeg: 0,
        text: '20 ס"מ',
        fontSizeCm: 5,
        pushDir: { x: 1, y: 0 },
        priority: 5,
      },
      {
        id: "a",
        anchor: { x: 10, y: 10 },
        rotationDeg: 0,
        text: '30 ס"מ',
        fontSizeCm: 5,
        pushDir: { x: 1, y: 0 },
        priority: 5,
      },
      {
        id: "c",
        anchor: { x: 10.4, y: 10.2 },
        rotationDeg: 15,
        text: '340 ס"מ',
        fontSizeCm: 6,
        pushDir: { x: 0, y: 1 },
        priority: 1_000_340,
      },
    ];

    const first = layoutLabels(candidates);
    const second = layoutLabels([...candidates].reverse());

    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
  });

  it("degrades gracefully instead of looping when a crowd cannot all be separated", () => {
    const candidates: LabelCandidate[] = Array.from({ length: 25 }, (_, i) => ({
      id: `crowd-${String(i).padStart(2, "0")}`,
      anchor: { x: 0, y: 0 },
      rotationDeg: 0,
      text: '20 ס"מ',
      fontSizeCm: 5,
      pushDir: { x: 1, y: 0 },
      priority: 0,
    }));

    const start = Date.now();
    const result = layoutLabels(candidates);
    const elapsedMs = Date.now() - start;

    // Every candidate still gets a finite, defined placement...
    expect(result.size).toBe(25);
    for (const placed of result.values()) {
      expect(Number.isFinite(placed.x)).toBe(true);
      expect(Number.isFinite(placed.y)).toBe(true);
    }
    // ...and the fixed attempt budget means this returns quickly rather than
    // hunting forever for a free spot that, with 25 same-anchor same-direction
    // labels, does not exist.
    expect(elapsedMs).toBeLessThan(500);
  });

  it("keeps priority order: length labels (1_000_000+) win placement over thickness labels", () => {
    const lengthLabel: LabelCandidate = {
      id: "len:w1",
      anchor: { x: 0, y: 0 },
      rotationDeg: 0,
      text: '546 ס"מ',
      fontSizeCm: 6,
      pushDir: { x: 0, y: 1 },
      priority: 1_000_546,
    };
    const thicknessLabel: LabelCandidate = {
      id: "thk:w1",
      anchor: { x: 0, y: 0 },
      rotationDeg: 0,
      text: '20 ס"מ',
      fontSizeCm: 5,
      pushDir: { x: 0, y: 1 },
      priority: 546,
    };

    const result = layoutLabels([thicknessLabel, lengthLabel]);
    // The length label was placed first, so it never moved from its anchor.
    expect(result.get("len:w1")).toEqual({ x: 0, y: 0, rotationDeg: 0 });
    // The thickness label had to move off the same anchor to avoid it.
    const thicknessPlaced = result.get("thk:w1")!;
    expect(thicknessPlaced.x === 0 && thicknessPlaced.y === 0).toBe(false);
  });
});

describe("fixed obstacles", () => {
  // Regression, 6/10/2026: at 1:50 the printed dimension offset works out to
  // ~15 cm of world space, which lands INSIDE a 20 cm wall. The solver only
  // received the dimension labels, so it had nothing to avoid and a length
  // label printed straight over the panel label `עץ 351`. Panel labels now go
  // in as obstacles.
  const panel = (id: string, x: number, y: number): LabelCandidate => ({
    id,
    anchor: { x, y },
    rotationDeg: 0,
    text: "עץ 351",
    fontSizeCm: 12,
    pushDir: { x: 1, y: 0 },
    priority: 0,
    fixed: true,
  });

  it("never moves an obstacle, whatever else wants its spot", () => {
    const result = layoutLabels([
      {
        id: "len:w1",
        anchor: { x: 0, y: 0 },
        rotationDeg: 0,
        text: '546 ס"מ',
        fontSizeCm: 13,
        pushDir: { x: 0, y: -1 },
        priority: 546,
      },
      panel("panel:p1", 0, 0),
    ]);

    expect(result.get("panel:p1")).toEqual({ x: 0, y: 0, rotationDeg: 0 });
  });

  it("pushes a length label clear of the panel label it used to print over", () => {
    const result = layoutLabels([
      {
        id: "len:w1",
        anchor: { x: 0, y: 0 },
        rotationDeg: 0,
        text: '546 ס"מ',
        fontSizeCm: 13,
        pushDir: { x: 0, y: -1 },
        priority: 546,
      },
      panel("panel:p1", 0, 0),
    ]);

    const placed = result.get("len:w1")!;
    expect(placed.y).toBeLessThan(0);
    expect(noOverlap(placed, '546 ס"מ', 13, { x: 0, y: 0 }, "עץ 351", 12)).toBe(true);
  });

  it("constrains even a label that outranks everything movable", () => {
    // Obstacles are registered before priority is considered at all, so the
    // highest-priority candidate still routes around them.
    const result = layoutLabels([
      panel("panel:p1", 0, 0),
      {
        id: "len:longest",
        anchor: { x: 0, y: 0 },
        rotationDeg: 0,
        text: '900 ס"מ',
        fontSizeCm: 13,
        pushDir: { x: 0, y: -1 },
        priority: 9_999_999,
      },
    ]);

    expect(result.get("len:longest")!.y).toBeLessThan(0);
  });
});

/** True when the two estimated label boxes do not overlap on both axes. */
function noOverlap(
  a: { x: number; y: number },
  aText: string,
  aFont: number,
  b: Point,
  bText: string,
  bFont: number
): boolean {
  const ea = estimatedHalfExtents(aText, aFont);
  const eb = estimatedHalfExtents(bText, bFont);
  const dx = Math.abs(a.x - b.x) - (ea.halfWidth + eb.halfWidth);
  const dy = Math.abs(a.y - b.y) - (ea.halfHeight + eb.halfHeight);
  return dx > 0 || dy > 0;
}
