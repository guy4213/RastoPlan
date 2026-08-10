import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES } from "../../defaults.js";
import { rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { tileProject } from "../../corners/tileProject.js";
import { classifyDywidagLength } from "../dywidag.js";
import { countAccessories } from "../countAccessories.js";
import { projectOf } from "./fixtures.js";

const rules = DEFAULT_ACCESSORY_RULES;

describe("classifyDywidagLength", () => {
  it("uses the standard 1m rod up to 30cm of wall", () => {
    expect(classifyDywidagLength(20, rules)).toBe("standard-1m");
    expect(classifyDywidagLength(30, rules)).toBe("standard-1m");
  });

  it("needs a longer rod above 30cm — the exact length is still open", () => {
    expect(classifyDywidagLength(31, rules)).toBe("long");
    expect(classifyDywidagLength(40, rules)).toBe("long");
  });

  it("honors a recalibrated threshold", () => {
    expect(classifyDywidagLength(40, { ...rules, dywidagStandardMaxThicknessCm: 40 })).toBe(
      "standard-1m"
    );
  });
});

function countFor(walls: Wall[]) {
  const { placements, layout } = tileProject(projectOf(walls));
  return countAccessories(placements, layout.edges, walls, rules);
}

describe("countAccessories — dywidag rod split", () => {
  it("a uniformly 20cm room needs only standard rods", () => {
    const count = countFor(rectangleWalls());
    expect(count.dywidagRodsLong).toBe(0);
    expect(count.dywidagRodsStandard).toBe(count.dywidagRods);
    expect(count.dywidagRods).toBeGreaterThan(0);
  });

  it("a 40cm wall puts its rods in the long bucket, and the split always sums to the total", () => {
    const walls = rectangleWalls().map((w) => (w.id === "bottom" ? { ...w, thickness: 40 } : w));
    const count = countFor(walls);

    expect(count.dywidagRodsLong).toBeGreaterThan(0);
    expect(count.dywidagRodsStandard).toBeGreaterThan(0);
    expect(count.dywidagRodsStandard + count.dywidagRodsLong).toBe(count.dywidagRods);
    // Nuts follow the rod total regardless of length — confirmed by all four
    // of the customer's sheets.
    expect(count.nuts).toBe(count.dywidagRods * rules.nutsPerDywidag);
  });

  it("thickness changes the rod LENGTH, never the rod count (quantity rule still open)", () => {
    const thin = countFor(rectangleWalls());
    const thick = countFor(rectangleWalls().map((w) => ({ ...w, thickness: 40 })));

    expect(thick.dywidagRods).toBe(thin.dywidagRods);
    expect(thick.dywidagRodsLong).toBe(thick.dywidagRods);
  });
});
