import { describe, expect, it } from "vitest";
import { choosePrintScale, PRINT_PAGE_SIZES_MM } from "../choosePrintScale.js";

describe("PRINT_PAGE_SIZES_MM", () => {
  it("matches the landscape ISO sheet sizes", () => {
    expect(PRINT_PAGE_SIZES_MM.A3).toEqual({ widthMm: 420, heightMm: 297 });
    expect(PRINT_PAGE_SIZES_MM.A1).toEqual({ widthMm: 841, heightMm: 594 });
    expect(PRINT_PAGE_SIZES_MM.A0).toEqual({ widthMm: 1189, heightMm: 841 });
  });
});

describe("choosePrintScale", () => {
  it("computes the printable area as page minus margin (both axes) minus title block (height only)", () => {
    const result = choosePrintScale(
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      "A3",
      10,
      20
    );
    expect(result.printableWidthMm).toBe(420 - 10 * 2);
    expect(result.printableHeightMm).toBe(297 - 10 * 2 - 20);
  });

  it("picks the largest scale (smallest 1:N) that fits on A3", () => {
    // At 1:20 the plan draws as 390*10/20 = 195mm x 250*10/20 = 125mm,
    // comfortably inside the 400x257 printable area (margin 10, title 20).
    const result = choosePrintScale(
      { minX: 0, minY: 0, maxX: 390, maxY: 250 },
      "A3",
      10,
      20
    );
    expect(result).toEqual({
      scale: 20,
      fits: true,
      printableWidthMm: 400,
      printableHeightMm: 257,
    });
  });

  it("steps up to the next scale when the smallest one would overflow one axis", () => {
    // width 850cm: at 1:20 -> 8500/20 = 425mm > 400mm printable width, fails.
    // at 1:25 -> 8500/25 = 340mm <= 400mm, and height fits easily. So 1:25 wins.
    const result = choosePrintScale(
      { minX: 0, minY: 0, maxX: 850, maxY: 100 },
      "A3",
      10,
      20
    );
    expect(result.scale).toBe(25);
    expect(result.fits).toBe(true);
  });

  it("returns fits:false with the smallest standard scale (1:1000) when nothing fits", () => {
    const result = choosePrintScale(
      { minX: 0, minY: 0, maxX: 500_000, maxY: 500_000 },
      "A3",
      10,
      20
    );
    expect(result.scale).toBe(1000);
    expect(result.fits).toBe(false);
  });

  it("gives A1 and A0 a larger printable area than A3 for the same margins", () => {
    const bounds = { minX: 0, minY: 0, maxX: 5000, maxY: 3000 };
    const a3 = choosePrintScale(bounds, "A3", 10, 20);
    const a1 = choosePrintScale(bounds, "A1", 10, 20);
    const a0 = choosePrintScale(bounds, "A0", 10, 20);
    // Same drawing fits a bigger scale (smaller N) on a bigger sheet.
    expect(a1.scale).toBeLessThanOrEqual(a3.scale);
    expect(a0.scale).toBeLessThanOrEqual(a1.scale);
  });

  it("handles an empty/degenerate bounding box without throwing, picking the largest scale", () => {
    const result = choosePrintScale({ minX: 10, minY: 10, maxX: 10, maxY: 10 }, "A3", 10, 20);
    expect(result.fits).toBe(true);
    expect(result.scale).toBe(20);
  });
});
