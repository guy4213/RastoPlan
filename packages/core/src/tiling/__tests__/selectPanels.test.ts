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

  it("requires a timber gap: 82cm -> one R80, 2cm gap (1–5cm range picks the tighter-fitting panel)", () => {
    const result = selectPanels(82, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);

    expect(result.flags).toHaveLength(0);
    expect(result.gap).toBe(2);
    expect(widthsOf(result.panels)).toEqual([80]);
  });

  it("no valid combination: 33cm falls between every reachable gap, flags gap-out-of-range", () => {
    const result = selectPanels(33, sparseCatalog(), DEFAULT_ACCESSORY_RULES);

    expect(result.flags).toEqual(["gap-out-of-range"]);
    expect(result.panels).toHaveLength(0);
  });

  it("stays fast on long walls with the full 15-width catalog (regression for the pre-92acbfb heap blowup)", () => {
    // Prior to the DP rewrite, brute-forcing every multiset over the full
    // Shiluvit B catalog for a wall in this length range exploded the heap
    // long before returning. Lock the DP path in: a > 10 m run must resolve
    // in a fraction of a second on any dev machine.
    const start = Date.now();
    const result = selectPanels(1275, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);
    const elapsed = Date.now() - start;

    expect(result.flags).toHaveLength(0);
    expect(result.gap).toBe(0);
    // Sum of widths must exactly equal the target.
    expect(result.panels.reduce((s, p) => s + p.width, 0)).toBe(1275);
    // Generous ceiling — the DP runs in a few ms locally; anything over
    // half a second means we've regressed into the old enumeration.
    expect(elapsed).toBeLessThan(500);
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

  it("uses an alternate combination when the preferred panel stock is limited", () => {
    const result = selectPanels(150, sparseCatalog(), DEFAULT_ACCESSORY_RULES, {
      R75: 1,
      R50: 3,
    });

    expect(result.flags).toEqual([]);
    expect(widthsOf(result.panels)).toEqual([50, 50, 50]);
  });

  it("keeps stocked units and reports only the exact missing remainder", () => {
    const result = selectPanels(300, sparseCatalog(), DEFAULT_ACCESSORY_RULES, {
      R75: 3,
    });

    expect(widthsOf(result.panels)).toEqual([75, 75, 75, 75]);
    expect(result.flags).toEqual([]);
    expect(result.missingPanelsByType).toEqual({ R75: 1 });
  });

  it("uses five stocked R75 units and marks only the remaining three as missing", () => {
    const result = selectPanels(600, sparseCatalog(), DEFAULT_ACCESSORY_RULES, {
      R75: 5,
    });

    expect(widthsOf(result.panels)).toEqual(Array.from({ length: 8 }, () => 75));
    expect(result.missingPanelsByType).toEqual({ R75: 3 });
  });

  it("lets imported inventory override stale false catalog flags", () => {
    const staleCatalog: PanelCatalog = {
      panels: sparseCatalog().panels.map((panel) => ({ ...panel, inStock: false })),
    };
    const result = selectPanels(600, staleCatalog, DEFAULT_ACCESSORY_RULES, { R75: 5 });

    expect(widthsOf(result.panels)).toEqual(Array.from({ length: 8 }, () => 75));
    expect(result.missingPanelsByType).toEqual({ R75: 3 });
  });

  it("customer case: places 38 stocked R75 units and reports only two missing", () => {
    const staleCatalog: PanelCatalog = {
      panels: sparseCatalog().panels.map((panel) => ({ ...panel, inStock: false })),
    };
    const result = selectPanels(3000, staleCatalog, DEFAULT_ACCESSORY_RULES, { R75: 38 });

    expect(result.panels.filter((panel) => panel.type === "R75")).toHaveLength(40);
    expect(result.missingPanelsByType).toEqual({ R75: 2 });
  });

  it("keeps finite-stock selection fast on long walls", () => {
    const availability = Object.fromEntries(
      DEFAULT_PANEL_CATALOG.panels.map((panel) => [panel.type, 100])
    );
    const start = Date.now();
    const result = selectPanels(
      1275,
      DEFAULT_PANEL_CATALOG,
      DEFAULT_ACCESSORY_RULES,
      availability
    );

    expect(result.flags).toEqual([]);
    expect(result.panels.reduce((sum, panel) => sum + panel.width, 0)).toBe(1275);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

/**
 * The 1–5cm timber-gap range (customer decision, 13/9/2026, replacing 5–9cm)
 * pinned against a single-width catalog, so the only variable in play is the
 * gap itself rather than which panel combination gets picked.
 */
describe("selectPanels — timber gap 1–5cm (13/9/2026 customer decision)", () => {
  const singleWidthCatalog: PanelCatalog = {
    panels: [
      {
        type: "R75",
        width: 75,
        height: 300,
        isLeading: true,
        inStock: true,
        kind: "straight",
        bomLabel: "פנאל 75/300",
      },
    ],
  };

  it("DEFAULT_ACCESSORY_RULES carries the new 1–5cm bounds", () => {
    expect(DEFAULT_ACCESSORY_RULES.timberGapMin).toBe(1);
    expect(DEFAULT_ACCESSORY_RULES.timberGapMax).toBe(5);
  });

  it("a 1cm gap is legal — previously illegal under the old 5–9cm floor", () => {
    const result = selectPanels(76, singleWidthCatalog, DEFAULT_ACCESSORY_RULES);

    expect(result.flags).toEqual([]);
    expect(result.gap).toBe(1);
    expect(widthsOf(result.panels)).toEqual([75]);
  });

  it.each([1, 2, 3, 4, 5])("a %icm gap is legal", (gap) => {
    const result = selectPanels(75 + gap, singleWidthCatalog, DEFAULT_ACCESSORY_RULES);

    expect(result.flags).toEqual([]);
    expect(result.gap).toBe(gap);
  });

  it.each([6, 7, 8, 9])(
    "a %icm gap is no longer legal — flags gap-out-of-range instead of the old 5–9cm fit",
    (gap) => {
      const result = selectPanels(75 + gap, singleWidthCatalog, DEFAULT_ACCESSORY_RULES);

      expect(result.flags).toEqual(["gap-out-of-range"]);
      expect(result.panels).toHaveLength(0);
    }
  );

  it("keeps the customer verification case exactly as before: 340cm -> R75,R75,R40,R75,R75, no gap", () => {
    // Every combination in this case is an exact fit — gap 0 — so the range
    // narrowing must not move it at all. This is the canonical case the whole
    // engine is checked against; it must stay green through every stage.
    const result = selectPanels(340, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);

    expect(result.flags).toHaveLength(0);
    expect(result.gap).toBe(0);
    expect(widthsOf(result.panels)).toEqual([75, 75, 75, 75, 40]);
  });
});
