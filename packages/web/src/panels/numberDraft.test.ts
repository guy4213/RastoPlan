import { describe, expect, it } from "vitest";
import { almostEqual, formatRounded, parseBoundedNumber } from "./numberDraft.js";

describe("parseBoundedNumber", () => {
  it("parses a plain integer", () => {
    expect(parseBoundedNumber("340")).toBe(340);
  });

  it("accepts a comma as a decimal separator", () => {
    expect(parseBoundedNumber("20,5")).toBeCloseTo(20.5);
  });

  it("returns null for empty input — the caller must revert, never commit 0", () => {
    expect(parseBoundedNumber("")).toBeNull();
    expect(parseBoundedNumber("   ")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseBoundedNumber("abc")).toBeNull();
  });

  it("returns null below the configured minimum", () => {
    expect(parseBoundedNumber("2", { min: 5 })).toBeNull();
    expect(parseBoundedNumber("5", { min: 5 })).toBe(5);
  });

  it("returns null above the configured maximum", () => {
    expect(parseBoundedNumber("999", { max: 40 })).toBeNull();
    expect(parseBoundedNumber("40", { max: 40 })).toBe(40);
  });

  it("returns null for non-finite input such as Infinity or NaN-producing text", () => {
    expect(parseBoundedNumber("Infinity")).toBeNull();
    expect(parseBoundedNumber("NaN")).toBeNull();
  });
});

describe("formatRounded", () => {
  it("renders an integer with no decimals requested", () => {
    expect(formatRounded(340)).toBe("340");
  });

  it("rounds to the requested decimal precision", () => {
    expect(formatRounded(20.049, 1)).toBe("20");
    expect(formatRounded(20.06, 1)).toBe("20.1");
  });

  it("drops a trailing .0", () => {
    expect(formatRounded(20, 1)).toBe("20");
  });
});

describe("almostEqual", () => {
  it("treats values within the epsilon as equal", () => {
    expect(almostEqual(20, 20.0009)).toBe(true);
  });

  it("treats values outside the epsilon as different", () => {
    expect(almostEqual(20, 20.04)).toBe(false);
  });

  it("supports a custom epsilon", () => {
    expect(almostEqual(20, 20.04, 0.05)).toBe(true);
  });
});
