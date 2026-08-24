import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
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
  it("lists every product in the customer's exact order and wording", () => {
    const labels = singlePourTemplate().rows.map((r) => r.label);

    expect(labels).toEqual([
      "פנאל 20/300",
      "פנאל 25/300",
      "פנאל 30/300",
      "פנאל 35/300",
      "פנאל 40/300",
      "פנאל 45/300",
      "פנאל 50/300",
      "פנאל 55/300",
      "פנאל 60/300",
      "פנאל 65/300",
      "פנאל 70/300",
      "פנאל 75/300",
      "פנאל 80/300",
      "פנאל 85/300",
      "פנאל 90/300",
      "פנאל 20/20/300",
      "פנאל 25/25/300",
      "פנאל 30/30/300",
      "חצאי פנאלים :",
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

  it("keeps unused product rows at 0 rather than dropping them", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    // Only the leading C30x30 is ever auto-placed, so the smaller corner
    // sizes stay on the sheet at zero — exactly as in the customer's files.
    const unused = rows.get("פנאל 20/20/300")!;

    expect(unused.requiredQty).toBe(0);
    expect(unused.totalSqm).toBe(0);
    expect(unused.perPour).toEqual([0]);
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
    expect(rows.get("פנאל 70/300")?.inventoryQty).toBe(0);
  });
});

describe("buildBomTemplate — מר לתבנית", () => {
  it("straight panel: width/100 × 3 — a 75 is 2.25m²", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    expect(rows.get("פנאל 75/300")?.sqmPerUnit).toBe(2.25);
    expect(rows.get("פנאל 40/300")?.sqmPerUnit).toBe(1.2);
    expect(rows.get("פנאל 90/300")?.sqmPerUnit).toBe(2.7);
  });

  it("corner panel: BOTH legs — 30/30/300 is 1.8m², not 0.9", () => {
    const rows = new Map(singlePourTemplate().rows.map((r) => [r.label, r]));
    expect(rows.get("פנאל 30/30/300")?.sqmPerUnit).toBe(1.8);
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

    expect(grid[8]?.[0]).toBe("פנאל 20/300");
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
