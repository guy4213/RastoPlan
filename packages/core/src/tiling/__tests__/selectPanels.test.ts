import { describe, expect, it } from "vitest";
import type { PanelCatalog } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { selectPanels } from "../selectPanels.js";

function widthsOf(panels: { width: number }[]): number[] {
  return panels.map((p) => p.width).sort((a, b) => b - a);
}

/**
 * A deliberately sparse catalog. The full Shiluvit B catalog stocks every
 * width from 20 to 90 in 5cm steps, which leaves almost no run unfillable and
 * almost no tie for the priority order to break — so the cases below pin the
 * ALGORITHM against a stock list narrow enough to have gaps and ties.
 */
function sparseCatalog(): PanelCatalog {
  const widths = [75, 60, 55, 50, 40];
  return {
    panels: widths.map((width) => ({
      type: `R${width}`,
      width,
      height: 300,
      isLeading: width === 75,
      inStock: true,
      kind: "straight" as const,
      bomLabel: `פנאל ${width}/300`,
    })),
  };
}

describe("selectPanels", () => {
  it("customer verification case: 340cm -> four R75 + one R40, no timber gap", () => {
    const result = selectPanels(340, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);

    expect(result.flags).toHaveLength(0);
    expect(result.gap).toBe(0);
    expect(widthsOf(result.panels)).toEqual([75, 75, 75, 75, 40]);
  });

  it("exact fit with no timber gap: 300cm -> four R75", () => {
    const result = selectPanels(300, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);

    expect(result.flags).toHaveLength(0);
    expect(result.gap).toBe(0);
    expect(widthsOf(result.panels)).toEqual([75, 75, 75, 75]);
  });

  it("requires a timber gap: 82cm -> one R75, 7cm gap", () => {
    const result = selectPanels(82, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);

    expect(result.flags).toHaveLength(0);
    expect(result.gap).toBe(7);
    expect(widthsOf(result.panels)).toEqual([75]);
  });

  it("no valid combination: 42cm falls between every reachable gap, flags gap-out-of-range", () => {
    const result = selectPanels(42, sparseCatalog(), DEFAULT_ACCESSORY_RULES);

    expect(result.flags).toEqual(["gap-out-of-range"]);
    expect(result.panels).toHaveLength(0);
  });

  it("respects tilingPriority order: 270cm picks more leading panels by default, but the lowest gap when min-gap is prioritized first", () => {
    const byLeadingFirst = selectPanels(270, sparseCatalog(), DEFAULT_ACCESSORY_RULES);
    expect(widthsOf(byLeadingFirst.panels)).toEqual([75, 75, 75, 40]);
    expect(byLeadingFirst.gap).toBe(5);

    const byGapFirst = selectPanels(270, sparseCatalog(), {
      ...DEFAULT_ACCESSORY_RULES,
      tilingPriority: ["min-gap", "leading", "min-panels"],
    });
    expect(widthsOf(byGapFirst.panels)).toEqual([75, 75, 60, 60]);
    expect(byGapFirst.gap).toBe(0);
  });
});
