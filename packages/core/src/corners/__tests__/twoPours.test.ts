import { describe, expect, it } from "vitest";
import type { Placement, Pour, Project } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { countAccessories } from "../../accessories/countAccessories.js";
import { countPanels } from "../../accessories/countPanels.js";
import { countAccessoriesByPour, countPanelsByPour } from "../../accessories/countByPour.js";
import { buildBomTemplate } from "../../export/buildBomTemplate.js";
import { twoPourDoubleContourWalls } from "../../geometry/__tests__/fixtures.js";
import { tileProject } from "../tileProject.js";

/**
 * The phase's acceptance scenario: two pours, each drawn as two contours, at
 * two different wall thicknesses — one of them 10cm, the width that used to
 * fall under the plausible-thickness floor and come back as two walls carrying
 * two full sets of formwork.
 *
 * Everything here is about attribution: nothing may be counted twice, nothing
 * may go missing, and nothing may land in the wrong pour.
 */
const POURS: Pour[] = [
  { id: "pour-1", name: "יציקה 1", color: "#dc2626", order: 0, defaultThicknessCm: 20 },
  { id: "pour-2", name: "יציקה 2", color: "#2563eb", order: 1, defaultThicknessCm: 10 },
];

function twoPourProject(): Project {
  return {
    id: "proj-two-pours",
    name: "שתי יציקות",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: POURS,
    walls: twoPourDoubleContourWalls(),
    placements: [],
    schemaVersion: 3,
  };
}

const project = twoPourProject();
const { layout, placements } = tileProject(project);
const walls = project.walls;

/** Where a placement physically sits — the same key twice means doubled formwork. */
function footprintOf(p: Placement): string {
  return [p.edgeId, p.side, p.offsetAlongEdge.toFixed(2), p.width.toFixed(2)].join("|");
}

describe("two pours — the two contours of each wall collapse into one", () => {
  it("resolves 8 walls out of 16 drawn lines, not 16", () => {
    expect(walls).toHaveLength(16);
    expect(layout.resolvedWalls).toHaveLength(8);
    expect(layout.resolvedWalls.flatMap((w) => w.consumedWallIds)).toHaveLength(8);
  });

  it("measures each pour's own thickness off its own drawing", () => {
    const byPour = (pourId: string) => layout.resolvedWalls.filter((w) => w.pourId === pourId);

    expect(byPour("pour-1")).toHaveLength(4);
    expect(byPour("pour-2")).toHaveLength(4);
    for (const wall of byPour("pour-1")) expect(wall.thickness).toBe(20);
    for (const wall of byPour("pour-2")) expect(wall.thickness).toBe(10);
  });

  it("keeps thickness, faceBOffsetCm and the drawn geometry in step in both pours", () => {
    for (const wall of layout.resolvedWalls) {
      expect(wall.faceBOffsetCm, wall.id).toBe(wall.thickness);
      expect(wall.thicknessSource, wall.id).toBe("measured");
    }
  });

  it("reports no pairing problem at all", () => {
    const codes = layout.diagnostics.filter((d) => d.severity !== "info").map((d) => d.code);
    expect(codes).toEqual([]);
  });
});

describe("two pours — nothing doubled, nothing dropped", () => {
  it("emits no duplicate placement", () => {
    const ids = placements.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    const footprints = placements.map(footprintOf);
    expect(new Set(footprints).size).toBe(footprints.length);
  });

  it("places nothing on a wall that was only the far face of another", () => {
    const consumed = new Set(layout.resolvedWalls.flatMap((w) => w.consumedWallIds));
    for (const placement of placements) {
      expect(consumed.has(placement.wallId), placement.id).toBe(false);
    }
    // Struts and rods read layout.edges: a consumed edge left in there is a
    // second helping of both.
    expect(layout.edges).toHaveLength(8);
  });

  it("gives every resolved wall one row on each of its two drawn contours", () => {
    for (const wall of layout.resolvedWalls) {
      const sides = new Set(placements.filter((p) => p.wallId === wall.id).map((p) => p.side));
      expect([...sides].sort(), wall.id).toEqual(["faceA", "faceB"]);
    }
  });

  it("assigns every placement to exactly one pour, and to the right one", () => {
    const pourOfWall = new Map(layout.resolvedWalls.map((w) => [w.id, w.pourId]));
    for (const placement of placements) {
      expect(placement.pourId, placement.id).toBe(pourOfWall.get(placement.wallId));
    }
  });
});

describe("two pours — the per-pour split adds up to the whole", () => {
  const byPour = countAccessoriesByPour(placements, layout.edges, walls, project.rules);
  const panelsByPour = countPanelsByPour(placements, walls);
  const total = countAccessories(placements, layout.edges, walls, project.rules);
  const panels = countPanels(placements);

  it("splits accessories into exactly the two pours", () => {
    expect(Object.keys(byPour.byPour).sort()).toEqual(["pour-1", "pour-2"]);
  });

  it("sums the per-pour accessory counts back to the project total", () => {
    for (const field of [
      "cornerClamps",
      "straightClamps",
      "dywidagRods",
      "nuts",
      "struts",
    ] as const) {
      const summed = Object.values(byPour.byPour).reduce((s, b) => s + b[field], 0);
      expect(summed, field).toBe(total[field]);
      expect(byPour.total[field], field).toBe(total[field]);
    }
  });

  it("keeps crane adapters project-scoped rather than inventing a per-pour share", () => {
    for (const bucket of Object.values(byPour.byPour)) expect(bucket.craneAdapters).toBe(0);
    expect(byPour.total.craneAdapters).toBe(project.rules.craneAdaptersPerProject);
  });

  it("loses no panel between the pours", () => {
    const summed: Record<string, number> = {};
    for (const bucket of Object.values(panelsByPour.byPour)) {
      for (const [type, count] of Object.entries(bucket.byType)) {
        summed[type] = (summed[type] ?? 0) + count;
      }
    }
    expect(summed).toEqual(panels.byType);

    const timber = Object.values(panelsByPour.byPour).reduce((s, b) => s + b.timberPieces, 0);
    expect(timber).toBe(panels.timberPieces);
  });

  it("gives both pours real quantities — neither comes back empty", () => {
    for (const pourId of ["pour-1", "pour-2"]) {
      const bucket = byPour.byPour[pourId]!;
      expect(bucket.straightClamps, pourId).toBeGreaterThan(0);
      expect(bucket.cornerClamps, pourId).toBe(4 * project.rules.cornerClampsPerCorner);
      expect(bucket.struts, pourId).toBeGreaterThan(0);
    }
  });

  it("sizes dywidag rods from each pour's own wall thickness", () => {
    // Both rooms are under the 30cm standard-rod limit, so neither pour may
    // book a long rod — this is the check that thickness reaches the rod class.
    for (const bucket of Object.values(byPour.byPour)) {
      expect(bucket.dywidagRodsLong).toBe(0);
      expect(bucket.dywidagRodsStandard).toBe(bucket.dywidagRods);
    }
  });
});

describe("two pours — the exported bill of quantities", () => {
  it("gets one column per pour, and rents the busiest pour rather than the sum", () => {
    const template = buildBomTemplate({
      header: { companyName: "רסטו", projectName: "שתי יציקות", note: "", date: "2026-01-01" },
      catalog: project.catalog,
      pourIds: POURS.map((p) => p.id),
      pourNames: POURS.map((p) => p.name),
      panels: countPanelsByPour(placements, walls),
      accessories: countAccessoriesByPour(placements, layout.edges, walls, project.rules),
    });

    expect(template.pourNames).toEqual(["יציקה 1", "יציקה 2"]);
    for (const row of template.rows) {
      expect(row.perPour).toHaveLength(2);
      if (row.isSectionLabel) continue;
      // Formwork is reused between pours, so what has to be on site is the
      // busiest single pour — never the running total.
      expect(row.requiredQty, row.label).toBe(Math.max(...row.perPour));
    }
  });
});
