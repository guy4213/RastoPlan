import { describe, expect, it } from "vitest";
import type { AccessoryCount, CountByPour } from "../types.js";
import { applyQuantityOverrides } from "../applyOverrides.js";

function bucket(cornerClamps: number, straightClamps: number): AccessoryCount {
  return {
    cornerClamps,
    straightClamps,
    dywidagRods: 10,
    dywidagRodsStandard: 10,
    dywidagRodsLong: 0,
    nuts: 20,
    struts: 5,
    craneAdapters: 0,
  };
}

function counts(): CountByPour<AccessoryCount> {
  return {
    byPour: { "pour-1": bucket(12, 90), "pour-2": bucket(8, 60) },
    total: { ...bucket(20, 150), craneAdapters: 2 },
  };
}

describe("applyQuantityOverrides", () => {
  it("passes everything through untouched when there are no overrides", () => {
    expect(applyQuantityOverrides(counts(), undefined).counts).toEqual(counts());
  });

  it("replaces one pour's value and recomputes the total from the effective values", () => {
    const { counts: result, replaced } = applyQuantityOverrides(counts(), {
      cornerClamps: { "pour-1": 9 },
    });

    expect(result.byPour["pour-1"]!.cornerClamps).toBe(9);
    expect(result.byPour["pour-2"]!.cornerClamps).toBe(8);
    expect(result.total.cornerClamps).toBe(17);
    expect(replaced.get("cornerClamps:pour-1")).toBe(12);
  });

  it("honours a zero override instead of falling back to the automatic value", () => {
    const { counts: result } = applyQuantityOverrides(counts(), {
      straightClamps: { "pour-1": 0 },
    });

    expect(result.byPour["pour-1"]!.straightClamps).toBe(0);
    expect(result.total.straightClamps).toBe(60);
  });

  it("treats null as 'use the automatic value'", () => {
    const { counts: result, replaced } = applyQuantityOverrides(counts(), {
      cornerClamps: { "pour-1": null },
    });

    expect(result.byPour["pour-1"]!.cornerClamps).toBe(12);
    expect(replaced.size).toBe(0);
  });

  it("ignores an override for a pour that no longer exists", () => {
    const { counts: result } = applyQuantityOverrides(counts(), {
      cornerClamps: { "pour-deleted": 99 },
    });

    expect(result.total.cornerClamps).toBe(20);
    expect(Object.keys(result.byPour)).toEqual(["pour-1", "pour-2"]);
  });

  it("leaves non-clamp line items alone", () => {
    const { counts: result } = applyQuantityOverrides(counts(), {
      cornerClamps: { "pour-1": 1 },
    });

    expect(result.total.struts).toBe(counts().total.struts);
    expect(result.total.dywidagRods).toBe(counts().total.dywidagRods);
    expect(result.total.craneAdapters).toBe(2);
  });
});
