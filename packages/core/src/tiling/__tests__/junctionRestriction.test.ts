import { describe, expect, it } from "vitest";
import type { NodeType, Placement, Project, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { tileProject } from "../../corners/tileProject.js";
import {
  JUNCTION_RESTRICTED_FLAG,
  panelAllowedAtEnds,
  restrictedPanelMayLandOffJunction,
  withJunctionRestrictionFlag,
} from "../junctionRestriction.js";
import { planRun } from "../tileWall.js";
import { selectPanels } from "../selectPanels.js";

const R90 = DEFAULT_PANEL_CATALOG.panels.find((p) => p.type === "R90")!;
const R75 = DEFAULT_PANEL_CATALOG.panels.find((p) => p.type === "R75")!;
const types = (result: { panels: { type: string }[] }) => result.panels.map((p) => p.type).sort();

describe("the default catalog", () => {
  it("restricts R90 to T junctions and nothing else", () => {
    expect(R90.allowedAtNodeTypes).toEqual(["T"]);
    const restricted = DEFAULT_PANEL_CATALOG.panels.filter((p) => p.allowedAtNodeTypes);
    expect(restricted.map((p) => p.type)).toEqual(["R90"]);
  });
});

describe("panelAllowedAtEnds", () => {
  it("never limits an unrestricted panel", () => {
    expect(panelAllowedAtEnds(R75, [])).toBe(true);
    expect(panelAllowedAtEnds(R75, ["L", "L"])).toBe(true);
  });

  it("allows a restricted panel only when one end qualifies", () => {
    expect(panelAllowedAtEnds(R90, ["T"])).toBe(true);
    expect(panelAllowedAtEnds(R90, ["L", "T"])).toBe(true);
    for (const other of ["L", "cross", "end", "straight-join"] as NodeType[]) {
      expect(panelAllowedAtEnds(R90, [other]), other).toBe(false);
    }
    expect(panelAllowedAtEnds(R90, [])).toBe(false);
  });

  it("reports only the mixed case as possibly landing off the junction", () => {
    expect(restrictedPanelMayLandOffJunction(R90, ["L", "T"])).toBe(true);
    expect(restrictedPanelMayLandOffJunction(R90, ["T"])).toBe(false);
    expect(restrictedPanelMayLandOffJunction(R90, ["L"])).toBe(false);
    expect(restrictedPanelMayLandOffJunction(R75, ["L", "T"])).toBe(false);
  });
});

describe("selectPanels with a junction restriction", () => {
  // 90cm is exactly one R90: fewest panels, so the selector picks it whenever allowed.
  it("never selects R90 on a straight run or at L, cross, end or a straight join", () => {
    for (const ends of [[], ["L"], ["L", "L"], ["cross"], ["end", "end"], ["straight-join"]] as NodeType[][]) {
      const result = selectPanels(90, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES, undefined, ends);
      expect(types(result), ends.join(",")).not.toContain("R90");
      expect(result.flags).toEqual([]);
    }
  });

  it("makes R90 available at a T", () => {
    const result = selectPanels(90, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES, undefined, ["T", "end"]);
    expect(types(result)).toEqual(["R90"]);
  });

  it("is a prohibition, not a requirement: a T still prefers the leading R75 where it fits", () => {
    const plan = planRun(340, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES, undefined, ["T", "L"]);
    expect(plan.items.map((i) => (i.kind === "panel" ? i.panel.type : "timber"))).toEqual([
      "R75",
      "R75",
      "R40",
      "R75",
      "R75",
    ]);
  });

  it("still tiles a T run when R90 is out of stock", () => {
    const availability = Object.fromEntries(DEFAULT_PANEL_CATALOG.panels.map((p) => [p.type, 50]));
    availability["R90"] = 0;
    const result = selectPanels(90, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES, availability, ["T"]);
    expect(types(result)).not.toContain("R90");
    expect(result.panels.length).toBeGreaterThan(0);
    expect(result.missingPanelsByType).toEqual({});
    expect(result.flags).toEqual([]);
  });

  it("keeps the canonical 340cm middle rule on an ordinary wall", () => {
    const plan = planRun(340, DEFAULT_PANEL_CATALOG, DEFAULT_ACCESSORY_RULES);
    expect(plan.items.map((i) => (i.kind === "panel" ? i.panel.type : "timber"))).toEqual([
      "R75",
      "R75",
      "R40",
      "R75",
      "R75",
    ]);
  });
});

function projectOf(walls: Wall[], placements: Placement[] = []): Project {
  return {
    id: "proj-t",
    name: "t",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [{ id: "pour-1", name: "יציקה 1", color: "#000", order: 0, defaultThicknessCm: 20 }],
    walls,
    placements,
    schemaVersion: 4,
  };
}

const line = (id: string, a: [number, number], b: [number, number]): Wall => ({
  id,
  pourId: "pour-1",
  innerLine: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }],
  thickness: 20,
});

/** A through wall split at (200,0) and a 90cm stem ending there — a real T. */
const tWithShortStem = () => [
  line("left", [0, 0], [200, 0]),
  line("right", [200, 0], [400, 0]),
  line("stem", [200, 0], [200, 90]),
];

describe("tileProject with junction-restricted panels", () => {
  it("records each wall's end node types on the layout", () => {
    const { layout } = tileProject(projectOf(tWithShortStem()));
    const byId = new Map(layout.resolvedWalls.map((w) => [w.id, w.endNodeTypes]));
    expect(byId.get("stem")).toEqual(["T", "end"]);
    expect(byId.get("left")).toEqual(["T", "end"]);
    expect(byId.get("right")).toEqual(["T", "end"]);
  });

  it("uses R90 on a wall that ends at a T, and warns that it may sit at the non-T end", () => {
    const { placements, layout } = tileProject(projectOf(tWithShortStem()));
    expect(placements.filter((p) => p.wallId === "stem").map((p) => p.panelType)).toEqual(["R90"]);
    const warnings = layout.diagnostics.filter((d) => d.code === "restricted-panel-off-junction");
    expect(warnings.map((d) => d.wallIds[0])).toContain("stem");
    expect(warnings[0]!.message).toContain("R90");
  });

  it("never uses R90 on the same 90cm wall once it is not at a T", () => {
    const { placements } = tileProject(projectOf([line("stem", [200, 0], [200, 90])]));
    expect(placements.map((p) => p.panelType)).not.toContain("R90");
  });

  it("never places R90 automatically on a plain room with no T junction", () => {
    const { placements } = tileProject(projectOf(rectangleWalls()));
    expect(placements.map((p) => p.panelType)).not.toContain("R90");
  });

  it("accepts a manual R90 outside a T but flags it and reports it", () => {
    const first = tileProject(projectOf(rectangleWalls())).placements;
    const target = first.find((p) => p.kind === "panel" && p.panelType === "R75")!;
    const edited = first.map((p) =>
      p.id === target.id ? { ...p, panelType: "R90", width: 90, source: "manual" as const } : p
    );
    const { placements, layout } = tileProject(projectOf(rectangleWalls(), edited));

    const manual = placements.find((p) => p.id === target.id)!;
    expect(manual.panelType).toBe("R90");
    expect(manual.flags).toContain(JUNCTION_RESTRICTED_FLAG);
    expect(layout.diagnostics.map((d) => d.code)).toContain("manual-panel-junction-restricted");
  });

  it("does not flag a manual R90 on a wall at a T", () => {
    const first = tileProject(projectOf(tWithShortStem())).placements;
    const stem = first.find((p) => p.wallId === "stem")!;
    const edited = first.map((p) => (p.id === stem.id ? { ...p, source: "manual" as const } : p));
    const { placements } = tileProject(projectOf(tWithShortStem(), edited));
    expect(placements.find((p) => p.id === stem.id)!.flags).not.toContain(JUNCTION_RESTRICTED_FLAG);
  });
});

describe("withJunctionRestrictionFlag", () => {
  const base: Placement = {
    id: "p",
    edgeId: "edge:w",
    wallId: "w",
    pourId: "pour-1",
    side: "faceA",
    faceIsInterior: true,
    kind: "panel",
    panelType: "R90",
    offsetAlongEdge: 0,
    width: 90,
    source: "manual",
    flags: ["inventory-shortage"],
  };

  it("adds the flag off a T and removes it again at a T, keeping other flags", () => {
    const flagged = withJunctionRestrictionFlag(base, DEFAULT_PANEL_CATALOG, ["L", "L"]);
    expect(flagged.flags).toEqual(["inventory-shortage", JUNCTION_RESTRICTED_FLAG]);
    const cleared = withJunctionRestrictionFlag(flagged, DEFAULT_PANEL_CATALOG, ["T", "L"]);
    expect(cleared.flags).toEqual(["inventory-shortage"]);
  });

  it("leaves the placement untouched when the wall's ends are unknown or nothing changes", () => {
    expect(withJunctionRestrictionFlag(base, DEFAULT_PANEL_CATALOG, undefined)).toBe(base);
    const r75 = { ...base, panelType: "R75", width: 75 };
    expect(withJunctionRestrictionFlag(r75, DEFAULT_PANEL_CATALOG, ["L"])).toBe(r75);
  });
});
