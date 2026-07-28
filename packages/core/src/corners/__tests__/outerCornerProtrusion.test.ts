import { describe, expect, it } from "vitest";
import { DEFAULT_ACCESSORY_RULES } from "../../defaults.js";
import { outerCornerProtrusionFor } from "../outerCornerProtrusion.js";

const rules = DEFAULT_ACCESSORY_RULES;

describe("outerCornerProtrusionFor", () => {
  it("returns the standard 10cm at the reference neighbour thickness of 20", () => {
    expect(outerCornerProtrusionFor(20, rules)).toBe(10);
  });

  it("a thicker neighbour eats into the overlap, cm for cm", () => {
    expect(outerCornerProtrusionFor(22, rules)).toBe(8);
    expect(outerCornerProtrusionFor(23, rules)).toBe(7);
  });

  it("bottoms out at 5cm — below that the rest is filled with timber", () => {
    expect(outerCornerProtrusionFor(25, rules)).toBe(5);
    expect(outerCornerProtrusionFor(30, rules)).toBe(5);
    expect(outerCornerProtrusionFor(40, rules)).toBe(5);
  });

  it("never exceeds the standard, however thin the neighbour is", () => {
    expect(outerCornerProtrusionFor(15, rules)).toBe(10);
    expect(outerCornerProtrusionFor(0, rules)).toBe(10);
  });

  it("is driven entirely by the rules, so the bounds can be recalibrated", () => {
    const custom = {
      ...rules,
      outerCornerProtrusionCm: 12,
      outerCornerProtrusionMinCm: 8,
      outerCornerProtrusionReferenceThicknessCm: 25,
    };
    expect(outerCornerProtrusionFor(25, custom)).toBe(12);
    expect(outerCornerProtrusionFor(27, custom)).toBe(10);
    expect(outerCornerProtrusionFor(40, custom)).toBe(8);
  });
});
