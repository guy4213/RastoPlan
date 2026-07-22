import { describe, expect, it } from "vitest";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { buildGraph } from "../../geometry/buildGraph.js";
import { classifyNodes } from "../../geometry/classifyNodes.js";
import { classifyCornerSides } from "../../geometry/classifyCornerSides.js";
import { rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { placeCornerPanels } from "../../corners/placeCornerPanels.js";
import { tileProject } from "../../corners/tileProject.js";
import { countAccessoriesByPour, countPanelsByPour } from "../countByPour.js";
import { projectOf, twoPourWalls } from "./fixtures.js";

describe("countAccessoriesByPour — single-pour project", () => {
  it("puts the whole count under the single pour, matching the ungrouped total (except craneAdapters)", () => {
    const walls = rectangleWalls();
    const project = projectOf(walls);
    const placements = tileProject(project);
    const { nodes, edges } = buildGraph(walls);
    const classified = classifyCornerSides(classifyNodes(nodes, edges), edges);
    const corners = placeCornerPanels(
      classified,
      edges,
      walls,
      DEFAULT_PANEL_CATALOG,
      DEFAULT_ACCESSORY_RULES
    );
    const byPour = countAccessoriesByPour(
      placements,
      classified,
      corners.edges,
      walls,
      DEFAULT_ACCESSORY_RULES
    );

    expect(Object.keys(byPour.byPour)).toEqual(["pour-1"]);
    const only = byPour.byPour["pour-1"]!;

    // Everything except crane adapters lives inside the single pour.
    expect(only.cornerClamps).toBe(byPour.total.cornerClamps);
    expect(only.straightClamps).toBe(byPour.total.straightClamps);
    expect(only.dywidagRods).toBe(byPour.total.dywidagRods);
    expect(only.nuts).toBe(byPour.total.nuts);
    expect(only.struts).toBe(byPour.total.struts);

    // Crane adapters are project-scoped: 0 in the pour, 2 in the total.
    expect(only.craneAdapters).toBe(0);
    expect(byPour.total.craneAdapters).toBe(2);
  });
});

describe("countAccessoriesByPour — two-pour project", () => {
  it("each pour carries its own struts (sum matches project total)", () => {
    const { walls, pours } = twoPourWalls();
    const project = projectOf(walls, pours);
    const placements = tileProject(project);
    const { nodes, edges } = buildGraph(walls);
    const classified = classifyCornerSides(classifyNodes(nodes, edges), edges);
    const corners = placeCornerPanels(
      classified,
      edges,
      walls,
      DEFAULT_PANEL_CATALOG,
      DEFAULT_ACCESSORY_RULES
    );
    const byPour = countAccessoriesByPour(
      placements,
      classified,
      corners.edges,
      walls,
      DEFAULT_ACCESSORY_RULES
    );

    expect(byPour.byPour["pour-A"]).toBeDefined();
    expect(byPour.byPour["pour-B"]).toBeDefined();
    // Both pours own two 200cm walls: ceil(200/150) = 2 struts per wall,
    // so each pour has 4 struts — 8 total.
    expect(byPour.byPour["pour-A"]?.struts).toBe(4);
    expect(byPour.byPour["pour-B"]?.struts).toBe(4);
    expect(byPour.total.struts).toBe(8);
  });

  it("byPour.cornerClamps + byPour.straightClamps + byPour.struts sum to project totals", () => {
    const { walls, pours } = twoPourWalls();
    const project = projectOf(walls, pours);
    const placements = tileProject(project);
    const { nodes, edges } = buildGraph(walls);
    const classified = classifyCornerSides(classifyNodes(nodes, edges), edges);
    const corners = placeCornerPanels(
      classified,
      edges,
      walls,
      DEFAULT_PANEL_CATALOG,
      DEFAULT_ACCESSORY_RULES
    );
    const byPour = countAccessoriesByPour(
      placements,
      classified,
      corners.edges,
      walls,
      DEFAULT_ACCESSORY_RULES
    );

    const summed = { cornerClamps: 0, straightClamps: 0, dywidagRods: 0, nuts: 0, struts: 0 };
    for (const bucket of Object.values(byPour.byPour)) {
      summed.cornerClamps += bucket.cornerClamps;
      summed.straightClamps += bucket.straightClamps;
      summed.dywidagRods += bucket.dywidagRods;
      summed.nuts += bucket.nuts;
      summed.struts += bucket.struts;
    }
    expect(summed.cornerClamps).toBe(byPour.total.cornerClamps);
    expect(summed.straightClamps).toBe(byPour.total.straightClamps);
    expect(summed.dywidagRods).toBe(byPour.total.dywidagRods);
    expect(summed.nuts).toBe(byPour.total.nuts);
    expect(summed.struts).toBe(byPour.total.struts);
  });
});

describe("countPanelsByPour", () => {
  it("splits panel counts per pour, and byPour sums match the project total per type", () => {
    const { walls, pours } = twoPourWalls();
    const project = projectOf(walls, pours);
    const placements = tileProject(project);

    const byPour = countPanelsByPour(placements, walls);
    expect(byPour.byPour["pour-A"]).toBeDefined();
    expect(byPour.byPour["pour-B"]).toBeDefined();

    const summed: Record<string, number> = {};
    for (const bucket of Object.values(byPour.byPour)) {
      for (const [type, n] of Object.entries(bucket.byType)) {
        summed[type] = (summed[type] ?? 0) + n;
      }
    }
    expect(summed).toEqual(byPour.total.byType);
  });
});
