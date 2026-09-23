import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import { ACCESSORY_ITEMS, DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { tileProject } from "../../corners/tileProject.js";
import { countAccessoriesByPour, countPanelsByPour } from "../../accessories/countByPour.js";
import { projectOf, twoPourWalls } from "../../accessories/__tests__/fixtures.js";
import { buildBomTemplate, toGrid, type BuildBomTemplateInput } from "../buildBomTemplate.js";

const header = {
  companyName: "נפתלי ניסן",
  projectName: "קרית גת בניין B",
  note: "קומה טיפוסית",
  date: "11.06.2026",
};

const EMPTY_ACCESSORY_COUNT = {
  cornerClamps: 0,
  straightClamps: 0,
  dywidagRods: 0,
  dywidagRodsStandard: 0,
  dywidagRodsLong: 0,
  nuts: 0,
  struts: 0,
  craneAdapters: 0,
};

function inputFor(walls: Wall[], pourIds: string[], pourNames: string[]): BuildBomTemplateInput {
  const project = projectOf(
    walls,
    pourIds.map((id, i) => ({ id, name: pourNames[i]!, color: "#000", order: i }))
  );
  const { placements, layout } = tileProject(project);

  return {
    header,
    catalog: DEFAULT_PANEL_CATALOG,
    pourIds,
    pourNames,
    panels: countPanelsByPour(placements, walls),
    accessories: countAccessoriesByPour(placements, layout.edges, walls, DEFAULT_ACCESSORY_RULES),
  };
}

function singlePourTemplate() {
  return buildBomTemplate(inputFor(rectangleWalls(), ["pour-1"], ["יציקה 1"]));
}

/** On-site timber pieces the single-pour room produces — see the clamp test. */
function singlePourTimberPieces(): number {
  return countPanelsByPour(
    tileProject(projectOf(rectangleWalls(), [{ id: "pour-1", name: "יציקה 1", color: "#000", order: 0 }]))
      .placements,
    rectangleWalls()
  ).total.timberPieces;
}

describe("buildBomTemplate — product rows", () => {
  it("lists only the products actually used, in the customer's order and wording", () => {
    const labels = singlePourTemplate().rows.map((r) => r.label);

    // The rectangle fixture only ever uses R40/R75/R85 straight panels and the
    // leading C30x30 corner — every other catalog row is zero in this pour and
    // is omitted entirely rather than kept at 0 (approved rule change: a row
    // with zero quantity in every pour, and therefore in the MAX/"required"
    // column, does not appear at all).
    expect(labels).toEqual([
      "פנאל 40/300",
      "פנאל 75/300",
      "פנאל 85/300",
      "פנאל 30/30/300",
      "אביזרים :",
      "קלמרה רגילה לתבניות GT",
      "קלמרה פינתית לתבניות GT",
      "מתאם למנוף לתבניות רסטה",
      "הליכון(פיגום יציקה) לתבניות",
      "רגל תמיכה ופילוס כפולה לתבניות",
      "דיודגים",
      "אומים",
    ]);
  });

  it("omits a product row entirely once its quantity is zero in every pour", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    // Only the leading C30x30 is ever auto-placed, so the smaller corner
    // sizes never carry a quantity in this fixture and no longer get a row.
    expect(rows.has("פנאל 20/20/300")).toBe(false);
    expect(rows.has("פנאל 25/25/300")).toBe(false);
    expect(rows.has("פנאל 20/300")).toBe(false);
  });

  it("never reproduces the customer's dead 'חצאי פנאלים :' header — it labels nothing in their own sheet either", () => {
    // Explicit decision (Guy, 23/9/2026): unlike "אביזרים :", which always
    // introduces real accessory rows, this header never had any half-panel
    // product row under it even in the customer's own Priority template — so
    // it is dropped unconditionally, not just when its (nonexistent) group
    // is empty.
    const template = singlePourTemplate();
    expect(template.rows.some((r) => r.label === "חצאי פנאלים :")).toBe(false);
  });

  it("keeps the accessories section header only when at least one accessory row survives", () => {
    const template = singlePourTemplate();
    expect(template.rows.some((r) => r.label === "אביזרים :")).toBe(true);
  });

  it("copies finite inventory by exact product label and treats missing rows as zero", () => {
    const input = inputFor(rectangleWalls(), ["pour-1"], ["יציקה 1"]);
    input.inventory = {
      "פנאל 75/300": 12,
      "קלמרה רגילה לתבניות GT": 40,
    };
    const rows = new Map(buildBomTemplate(input).rows.map((row) => [row.label, row]));

    expect(rows.get("פנאל 75/300")?.inventoryQty).toBe(12);
    expect(rows.get("קלמרה רגילה לתבניות GT")?.inventoryQty).toBe(40);
    // A row that survives (nonzero required qty) but has no matching
    // inventory entry defaults to 0 — distinct from a zero-quantity row,
    // which is dropped from the sheet entirely regardless of inventory.
    expect(rows.get("פנאל 85/300")?.inventoryQty).toBe(0);
    expect(rows.has("פנאל 70/300")).toBe(false);
  });
});

describe("buildBomTemplate — מר לתבנית", () => {
  it("straight panel: width/100 × 3 — a 75 is 2.25m²", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    expect(rows.get("פנאל 75/300")?.sqmPerUnit).toBe(2.25);
    expect(rows.get("פנאל 40/300")?.sqmPerUnit).toBe(1.2);
    expect(rows.get("פנאל 85/300")?.sqmPerUnit).toBe(2.55);
  });

  it("corner panel: BOTH legs — 30/30/300 is 1.8m², not 0.9", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    expect(rows.get("פנאל 30/30/300")?.sqmPerUnit).toBe(1.8);
  });

  it("corner panel m² covers both legs at every size, once the row actually has a quantity", () => {
    // The rectangle fixture never places a 20 or 25 leg corner (only C30x30
    // auto-places), so those rows are omitted there under the new rule.
    // Feed synthetic per-pour counts instead to check the m² formula itself.
    const synthetic = buildBomTemplate({
      header,
      catalog: DEFAULT_PANEL_CATALOG,
      pourIds: ["pour-1"],
      pourNames: ["יציקה 1"],
      panels: {
        byPour: {
          "pour-1": { byType: { C25x25: 2, C20x20: 3 }, timberPieces: 0, timberLengthCm: 0 },
        },
        total: { byType: { C25x25: 2, C20x20: 3 }, timberPieces: 0, timberLengthCm: 0 },
      },
      accessories: { byPour: {}, total: EMPTY_ACCESSORY_COUNT },
    });
    const rows = new Map(synthetic.rows.map((r) => [r.label, r]));
    expect(rows.get("פנאל 25/25/300")?.sqmPerUnit).toBe(1.5);
    expect(rows.get("פנאל 20/20/300")?.sqmPerUnit).toBe(1.2);
  });

  it("accessory rows carry no m² at all", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    expect(rows.get("דיודגים")?.sqmPerUnit).toBeNull();
    expect(rows.get("דיודגים")?.totalSqm).toBeNull();
  });
});

describe("buildBomTemplate — quantities", () => {
  it("a 4-corner room lists 4 × פנאל 30/30/300, matching the customer's sheet", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    const corner = rows.get("פנאל 30/30/300")!;

    expect(corner.requiredQty).toBe(4);
    // 4 units × 1.8m² — the same 7.2 their בית שמש sheet shows.
    expect(corner.totalSqm).toBe(7.2);
  });

  it("corner clamps are 3 per corner panel, straight clamps 3 per straight panel", () => {
    const template = singlePourTemplate();
    const rows = new Map(template.rows.map((r) => [r.label, r]));

    const cornerUnits = rows.get("פנאל 30/30/300")!.requiredQty;
    expect(rows.get("קלמרה פינתית לתבניות GT")?.requiredQty).toBe(cornerUnits * 3);
    expect(rows.get("קלמרה פינתית לתבניות GT")?.requiredQty).toBe(12);

    const straightUnits = template.rows
      .filter((r) => r.label.startsWith("פנאל ") && !r.label.includes("/30/300"))
      .reduce((sum, r) => sum + r.requiredQty, 0);
    // The timber term is deliberate — see the note in countAccessories.test.ts
    // and docs/open-questions.md: the engine clamps timber fillers, the
    // customer's sheet counts only catalogue panels.
    expect(rows.get("קלמרה רגילה לתבניות GT")?.requiredQty).toBe(
      (straightUnits + singlePourTimberPieces()) * 3
    );
  });

  it("walkway and strut come as an equal pair, as in every sheet we have", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    expect(rows.get("הליכון(פיגום יציקה) לתבניות")?.requiredQty).toBe(
      rows.get("רגל תמיכה ופילוס כפולה לתבניות")?.requiredQty
    );
  });

  it("nuts are twice the dywidag rods — confirmed by all four customer sheets", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    expect(rows.get("אומים")?.requiredQty).toBe(rows.get("דיודגים")!.requiredQty * 2);
  });

  it('"כמות דרושה" is the MAX across pours, not the sum — formwork is reused', () => {
    const { walls, pours } = twoPourWalls();
    const template = buildBomTemplate(
      inputFor(
        walls,
        pours.map((p) => p.id),
        pours.map((p) => p.name)
      )
    );

    for (const row of template.rows) {
      if (row.isSectionLabel) continue;
      expect(row.requiredQty).toBe(Math.max(...row.perPour));
    }

    // And it really is smaller than the sum somewhere, or the assertion above
    // would pass trivially on a single-pour project.
    const summed = template.rows.some(
      (r) => r.perPour.reduce((a, b) => a + b, 0) > r.requiredQty
    );
    expect(summed).toBe(true);
  });

  it("one column per pour, in the order given", () => {
    const { walls, pours } = twoPourWalls();
    const template = buildBomTemplate(
      inputFor(
        walls,
        pours.map((p) => p.id),
        pours.map((p) => p.name)
      )
    );

    expect(template.pourNames).toEqual(["יציקה A", "יציקה B"]);
    for (const row of template.rows) expect(row.perPour).toHaveLength(2);
  });
});

describe("buildBomTemplate — zero-row omission leaves every surviving quantity untouched", () => {
  const { walls, pours } = twoPourWalls();
  const pourIds = pours.map((p) => p.id);
  const pourNames = pours.map((p) => p.name);
  const input = inputFor(walls, pourIds, pourNames);
  const template = buildBomTemplate(input);
  const panelByBomLabel = new Map(DEFAULT_PANEL_CATALOG.panels.map((p) => [p.bomLabel, p]));

  it("keeps K10 (straight clamps, incl. timber×3) and K30 (corner clamps) identical to the raw per-pour counts", () => {
    const straightClampRow = template.rows.find(
      (r) => r.label === ACCESSORY_ITEMS.straightClamp.label
    )!;
    const cornerClampRow = template.rows.find(
      (r) => r.label === ACCESSORY_ITEMS.cornerClamp.label
    )!;
    expect(straightClampRow).toBeDefined();
    expect(cornerClampRow).toBeDefined();

    pourIds.forEach((pourId, i) => {
      const byType = input.panels.byPour[pourId]?.byType ?? {};
      const timberPieces = input.panels.byPour[pourId]?.timberPieces ?? 0;
      let straightUnits = 0;
      let cornerUnits = 0;
      for (const [type, count] of Object.entries(byType)) {
        const kind = DEFAULT_PANEL_CATALOG.panels.find((p) => p.type === type)?.kind;
        if (kind === "straight") straightUnits += count;
        else cornerUnits += count;
      }

      // Same formula as the pre-omission sheet: K10 = 3 × (straight panels + timber pieces).
      expect(straightClampRow.perPour[i]).toBe((straightUnits + timberPieces) * 3);
      expect(cornerClampRow.perPour[i]).toBe(cornerUnits * 3);
      // And it matches the accessory engine's own bucket exactly — the row
      // filter never edits a kept row's numbers, only removes all-zero rows.
      expect(straightClampRow.perPour[i]).toBe(
        input.accessories.byPour[pourId]?.straightClamps ?? 0
      );
      expect(cornerClampRow.perPour[i]).toBe(input.accessories.byPour[pourId]?.cornerClamps ?? 0);
    });
  });

  it("keeps every surviving product row's per-pour numbers equal to the raw panel counts", () => {
    for (const row of template.rows) {
      if (row.isSectionLabel) continue;
      // Nothing kept is secretly empty — omission removes all-zero rows, so
      // whatever remains must have a real quantity somewhere.
      expect(row.perPour.some((v) => v !== 0), row.label).toBe(true);
      expect(row.requiredQty, row.label).toBe(Math.max(...row.perPour));

      const panel = panelByBomLabel.get(row.label);
      if (!panel) continue;
      pourIds.forEach((pourId, i) => {
        expect(row.perPour[i], `${row.label} @ ${pourId}`).toBe(
          input.panels.byPour[pourId]?.byType[panel.type] ?? 0
        );
      });
    }
  });
});

describe("buildBomTemplate — total m²", () => {
  it("sums the panel rows only, like the sheet's =SUM(D9:D26)", () => {
    const template = singlePourTemplate();
    const expected = template.rows
      .filter((r) => r.label.startsWith("פנאל "))
      .reduce((sum, r) => sum + (r.totalSqm ?? 0), 0);

    expect(template.totalSqm).toBeCloseTo(expected, 2);
    expect(template.totalSqm).toBeGreaterThan(0);
  });
});

describe("toGrid — sheet layout", () => {
  it("puts the header block on rows 1-5, leaves 6-7 blank, headers on row 8", () => {
    const grid = toGrid(singlePourTemplate());

    expect(grid[0]?.slice(0, 3)).toEqual(["שם החברה :", null, "נפתלי ניסן"]);
    expect(grid[1]?.slice(0, 3)).toEqual(["שם הפרוייקט :", null, "קרית גת בניין B"]);
    expect(grid[2]?.slice(0, 3)).toEqual(["הערה :", null, "קומה טיפוסית"]);
    expect(grid[3]?.slice(0, 3)).toEqual(["תאריך :", null, "11.06.2026"]);
    expect(grid[4]?.[0]).toBe('סה"כ מ"ר :');
    expect(grid[4]?.[1]).toBeNull();
    expect(grid[4]?.[2]).toBe(singlePourTemplate().totalSqm);

    expect(grid[5]?.every((c) => c === null)).toBe(true);
    expect(grid[6]?.every((c) => c === null)).toBe(true);

    expect(grid[7]).toEqual([
      "תאור מוצר",
      "מלאי ",
      "כמות דרושה לפרוייקט",
      "מר לתבנית",
      'סה"כ מר ',
      "יציקה 1",
    ]);
  });

  it("starts the products at row 9 and keeps every row the same width", () => {
    const template = singlePourTemplate();
    const grid = toGrid(template);

    expect(grid[8]?.[0]).toBe("פנאל 40/300");
    expect(grid).toHaveLength(8 + template.rows.length);
    const width = grid[7]!.length;
    for (const row of grid) expect(row).toHaveLength(width);
  });

  it("lays a product row out as label | inventory | qty | m² per unit | total m² | per-pour", () => {
    const grid = toGrid(singlePourTemplate());
    const row = grid.find((r) => r[0] === "פנאל 30/30/300")!;

    expect(row).toEqual(["פנאל 30/30/300", 0, 4, 1.8, 7.2, 4]);
  });
});
