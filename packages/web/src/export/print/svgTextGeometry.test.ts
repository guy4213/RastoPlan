import { describe, expect, it } from "vitest";
import { rtlTextAnchor, uprightRotationDeg } from "./svgTextGeometry.js";

describe("rtlTextAnchor", () => {
  it("maps 'right' (hug the page's right edge) to text-anchor=start for RTL text", () => {
    // This is the exact combination the title block needs: direction="rtl"
    // with text-anchor="start" so the string's visual right edge sits at x
    // and the string runs leftward, into the page.
    expect(rtlTextAnchor("right")).toBe("start");
  });

  it("maps 'left' to text-anchor=end for RTL text", () => {
    expect(rtlTextAnchor("left")).toBe("end");
  });

  it("maps 'center' to text-anchor=middle regardless of direction", () => {
    expect(rtlTextAnchor("center")).toBe("middle");
  });
});

describe("uprightRotationDeg", () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 0],
    [-90, 90],
    [270, 90],
  ])("folds %d° to %d°", (input, expected) => {
    expect(uprightRotationDeg(input)).toBeCloseTo(expected, 6);
  });

  it("leaves angles already inside (-90, 90] untouched", () => {
    expect(uprightRotationDeg(0)).toBe(0);
    expect(uprightRotationDeg(45)).toBe(45);
    expect(uprightRotationDeg(-45)).toBe(-45);
    expect(uprightRotationDeg(89)).toBe(89);
  });

  it("folds angles just past +90 by -180", () => {
    expect(uprightRotationDeg(91)).toBeCloseTo(-89, 6);
    expect(uprightRotationDeg(135)).toBeCloseTo(-45, 6);
    expect(uprightRotationDeg(179)).toBeCloseTo(-1, 6);
  });

  it("folds angles at or past -90 by +180", () => {
    expect(uprightRotationDeg(-91)).toBeCloseTo(89, 6);
    expect(uprightRotationDeg(-135)).toBeCloseTo(45, 6);
    expect(uprightRotationDeg(-179)).toBeCloseTo(1, 6);
  });

  it("handles inputs outside a single turn (>360 or negative multiples)", () => {
    expect(uprightRotationDeg(360)).toBe(0);
    expect(uprightRotationDeg(450)).toBeCloseTo(90, 6);
    expect(uprightRotationDeg(-360)).toBe(0);
    expect(uprightRotationDeg(-450)).toBeCloseTo(90, 6);
    expect(uprightRotationDeg(630)).toBeCloseTo(-90 + 180, 6); // 630 -> 270 -> -90 -> +90
  });

  it("never moves the angle by anything other than a multiple of 180 (the anchor point stays put)", () => {
    for (const angle of [0, 33, 91, 179, -17, -91, -179, 270, -270, 360, 725]) {
      const folded = uprightRotationDeg(angle);
      const diff = ((angle - folded) % 180 + 180) % 180;
      // diff should be ~0 (a multiple of 180), allowing for float error.
      expect(Math.min(diff, 180 - diff)).toBeLessThan(1e-6);
    }
  });

  it("always returns a value in (-90, 90]", () => {
    for (let angle = -720; angle <= 720; angle += 17) {
      const folded = uprightRotationDeg(angle);
      expect(folded).toBeGreaterThan(-90);
      expect(folded).toBeLessThanOrEqual(90);
    }
  });
});
