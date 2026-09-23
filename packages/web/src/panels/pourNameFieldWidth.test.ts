import { describe, expect, it } from "vitest";
import { NAME_FIELD_MAX_CH, NAME_FIELD_MIN_CH, nameFieldWidthCh } from "./pourNameFieldWidth.js";

describe("nameFieldWidthCh", () => {
  it("floors short names at the minimum width", () => {
    expect(nameFieldWidthCh("")).toBe(NAME_FIELD_MIN_CH);
    expect(nameFieldWidthCh("א")).toBe(NAME_FIELD_MIN_CH);
    expect(nameFieldWidthCh("יציקה")).toBe(NAME_FIELD_MIN_CH);
  });

  it("grows with the name, plus one character of headroom, inside the band", () => {
    const name = "יציקה 12"; // 8 chars
    expect(nameFieldWidthCh(name)).toBe(name.length + 1);
  });

  it("caps long names at the maximum width instead of growing further", () => {
    const long = "יציקה מספר ארבע עשרה בבניין המרכזי";
    expect(long.length).toBeGreaterThan(NAME_FIELD_MAX_CH);
    expect(nameFieldWidthCh(long)).toBe(NAME_FIELD_MAX_CH);
  });

  it("never returns a width outside [min, max]", () => {
    for (const name of ["", "a", "ab", "יציקה 1", "x".repeat(50)]) {
      const width = nameFieldWidthCh(name);
      expect(width).toBeGreaterThanOrEqual(NAME_FIELD_MIN_CH);
      expect(width).toBeLessThanOrEqual(NAME_FIELD_MAX_CH);
    }
  });
});
