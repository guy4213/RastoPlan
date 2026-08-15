import { describe, expect, it } from "vitest";
import { boundsOf, pickUnit, segmentsToWalls, summarizeLayers } from "../segmentsToWalls.js";
import type { CadSegment } from "../segmentsToWalls.js";

const makeId = (i: number) => `w${i}`;

/** A 400x300 rectangle drawn on "WALLS", plus noise on another layer. */
const RECT: CadSegment[] = [
  { x1: 0, y1: 0, x2: 400, y2: 0, layer: "WALLS" },
  { x1: 400, y1: 0, x2: 400, y2: 300, layer: "WALLS" },
  { x1: 400, y1: 300, x2: 0, y2: 300, layer: "WALLS" },
  { x1: 0, y1: 300, x2: 0, y2: 0, layer: "WALLS" },
  { x1: 10, y1: 10, x2: 12, y2: 12, layer: "HATCH" },
];

describe("summarizeLayers", () => {
  it("counts segments and length per layer, busiest first", () => {
    const summary = summarizeLayers(RECT, "cm");
    expect(summary.map((l) => l.name)).toEqual(["WALLS", "HATCH"]);
    expect(summary[0]!.segments).toBe(4);
    expect(summary[0]!.totalLengthCm).toBeCloseTo(1400);
  });

  it("scales length by the chosen unit", () => {
    expect(summarizeLayers(RECT, "mm")[0]!.totalLengthCm).toBeCloseTo(140);
    expect(summarizeLayers(RECT, "m")[0]!.totalLengthCm).toBeCloseTo(140000);
  });
});

describe("boundsOf", () => {
  it("reports the extent in centimetres", () => {
    const b = boundsOf(RECT, "cm")!;
    expect(b.widthCm).toBeCloseTo(400);
    expect(b.heightCm).toBeCloseTo(300);
  });

  it("is null for no segments", () => {
    expect(boundsOf([], "cm")).toBeNull();
  });
});

describe("pickUnit", () => {
  /** A 12m x 8m floor plan, expressed in whichever unit. */
  const planIn = (unitsPerMetre: number): CadSegment[] => [
    { x1: 0, y1: 0, x2: 12 * unitsPerMetre, y2: 0, layer: "W" },
    { x1: 0, y1: 0, x2: 0, y2: 8 * unitsPerMetre, layer: "W" },
  ];

  it("honours the header when it gives a building-sized result", () => {
    expect(pickUnit(planIn(1000), "mm")).toBe("mm");
    expect(pickUnit(planIn(100), "cm")).toBe("cm");
    expect(pickUnit(planIn(1), "m")).toBe("m");
  });

  it("overrides a header that would make the drawing absurd", () => {
    // The customer's own file: header claims mm, geometry is really cm. Read as
    // mm a 12m plan would come out 1.2m across.
    expect(pickUnit(planIn(100), "mm")).toBe("cm");
  });

  it("picks the only unit that makes sense when there is no header hint", () => {
    // 12 x 8 drawing units can only be a building if the units are metres.
    expect(pickUnit(planIn(1), undefined)).toBe("m");
  });

  it("prefers centimetres when more than one unit is plausible", () => {
    // 1200 x 800 units is a believable 12m plan in cm and a 120m site in mm.
    // Nothing in the geometry can settle that, so it takes the house unit and
    // the dialog shows the resulting size for the user to overrule.
    expect(pickUnit(planIn(100), undefined)).toBe("cm");
  });

  it("falls back to the header when no unit gives a building-sized result", () => {
    const tiny: CadSegment[] = [{ x1: 0, y1: 0, x2: 1, y2: 0, layer: "W" }];
    expect(pickUnit(tiny, "mm")).toBe("mm");
  });
});

describe("segmentsToWalls", () => {
  it("imports only the chosen layers", () => {
    const { walls } = segmentsToWalls(RECT, {
      pourByLayer: { WALLS: "pour-a" },
      unit: "cm",
      thicknessCm: 20,
      makeId,
    });
    expect(walls).toHaveLength(4);
    expect(walls.every((w) => w.pourId === "pour-a")).toBe(true);
    expect(walls.every((w) => w.thickness === 20)).toBe(true);
  });

  it("maps each layer to its own pour", () => {
    const segments: CadSegment[] = [
      { x1: 0, y1: 0, x2: 400, y2: 0, layer: "A" },
      { x1: 0, y1: 100, x2: 400, y2: 100, layer: "B" },
    ];
    const { walls } = segmentsToWalls(segments, {
      pourByLayer: { A: "pour-a", B: "pour-b" },
      unit: "cm",
      thicknessCm: 25,
      makeId,
    });
    expect(walls.map((w) => w.pourId)).toEqual(["pour-a", "pour-b"]);
  });

  it("drops segments shorter than the minimum and reports how many", () => {
    const { walls, skippedShort } = segmentsToWalls(RECT, {
      pourByLayer: { WALLS: "p", HATCH: "p" },
      unit: "cm",
      thicknessCm: 20,
      makeId,
    });
    // The 2.83cm hatch tick is noise, not a wall.
    expect(walls).toHaveLength(4);
    expect(skippedShort).toBe(1);
  });

  it("converts units — a 400mm line is a 40cm wall", () => {
    const { walls } = segmentsToWalls([{ x1: 0, y1: 0, x2: 400, y2: 0, layer: "W" }], {
      pourByLayer: { W: "p" },
      unit: "mm",
      thicknessCm: 20,
      makeId,
    });
    const [a, b] = walls[0]!.innerLine;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(40);
  });

  it("moves the drawing to the origin and reports the shift so export can undo it", () => {
    // Real plans sit at arbitrary world coordinates; the customer's is at ~126000cm.
    const far: CadSegment[] = RECT.filter((s) => s.layer === "WALLS").map((s) => ({
      ...s,
      x1: s.x1 + 126000,
      x2: s.x2 + 126000,
      y1: s.y1 - 47000,
      y2: s.y2 - 47000,
    }));
    const { walls, offsetCm } = segmentsToWalls(far, {
      pourByLayer: { WALLS: "p" },
      unit: "cm",
      thicknessCm: 20,
      makeId,
    });
    expect(offsetCm).toEqual({ x: -126000, y: 47000 });

    const xs = walls.flatMap((w) => w.innerLine.map((p) => p.x));
    const ys = walls.flatMap((w) => w.innerLine.map((p) => p.y));
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.min(...ys)).toBeCloseTo(0);

    // Subtracting the offset must land back on the source coordinates.
    expect(Math.min(...xs) - offsetCm.x).toBeCloseTo(126000);
  });

  it("returns nothing when no layer is chosen", () => {
    const { walls } = segmentsToWalls(RECT, {
      pourByLayer: {},
      unit: "cm",
      thicknessCm: 20,
      makeId,
    });
    expect(walls).toEqual([]);
  });
});
