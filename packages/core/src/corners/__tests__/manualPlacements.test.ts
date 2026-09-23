import { describe, expect, it } from "vitest";
import type { Edge, Placement, PlacementSide, Project, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { countPanels } from "../../accessories/countPanels.js";
import { doubleContourRoomWalls, rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { blockedSpansFor, subtractSpans } from "../../tiling/manualPlacements.js";
import { tileWallPair } from "../../tiling/tileWallPair.js";
import { tileProject } from "../tileProject.js";

function projectOf(walls: Wall[], placements: Placement[] = [], inventory?: Record<string, number>): Project {
  return {
    id: "proj-manual",
    name: "manual",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [{ id: "pour-1", name: "יציקה 1", color: "#000", order: 0, defaultThicknessCm: 20 }],
    walls,
    placements,
    schemaVersion: 3,
    ...(inventory ? { inventory } : {}),
  };
}

const runItems = (placements: Placement[], edgeId: string, side: PlacementSide) =>
  placements
    .filter(
      (p) =>
        p.edgeId === edgeId &&
        p.side === side &&
        (p.kind === "panel" || p.kind === "timber") &&
        !p.flags.includes("outer-corner-protrusion")
    )
    .sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);

/** Asserts the run is covered end to end with no hole and no overlap. */
function expectContinuous(row: Placement[], lo: number, hi: number) {
  expect(row.length).toBeGreaterThan(0);
  expect(Math.round(row[0]!.offsetAlongEdge)).toBe(lo);
  for (let i = 1; i < row.length; i++) {
    const prevEnd = Math.round(row[i - 1]!.offsetAlongEdge + row[i - 1]!.width);
    expect(Math.round(row[i]!.offsetAlongEdge), `seam ${i}`).toBe(prevEnd);
  }
  const last = row[row.length - 1]!;
  expect(Math.round(last.offsetAlongEdge + last.width)).toBe(hi);
}

/** Computes a layout, then hand-edits the second panel of the longest face-A run. */
function withManualEdit(walls: Wall[], patch: Partial<Placement>) {
  const first = tileProject(projectOf(walls)).placements;
  const edgeId = [...new Set(first.map((p) => p.edgeId))]
    .map((id) => ({ id, row: runItems(first, id, "faceA") }))
    .sort((a, b) => b.row.length - a.row.length)[0]!.id;
  const row = runItems(first, edgeId, "faceA");
  const lo = Math.round(row[0]!.offsetAlongEdge);
  const hi = Math.round(row[row.length - 1]!.offsetAlongEdge + row[row.length - 1]!.width);
  const target = row[1]!;
  const edited: Placement = { ...target, ...patch, source: "manual" };
  const placements = first.map((p) => (p.id === target.id ? edited : p));
  return { first, edgeId, lo, hi, edited, placements };
}

describe("span helpers", () => {
  it("merges overlapping blocked stretches and sorts them", () => {
    const p = (offsetAlongEdge: number, width: number) =>
      ({ offsetAlongEdge, width }) as Placement;
    expect(blockedSpansFor([p(100, 50), p(20, 30), p(140, 30)])).toEqual([
      { lo: 20, hi: 50 },
      { lo: 100, hi: 170 },
    ]);
  });

  it("does not round a blocked stretch onto a different physical interval", () => {
    const placement = { offsetAlongEdge: 10.4, width: 40 } as Placement;
    expect(blockedSpansFor([placement])).toEqual([{ lo: 10.4, hi: 50.4 }]);
  });

  it("subtracts blocked stretches from a run", () => {
    expect(subtractSpans({ lo: 0, hi: 300 }, [{ lo: 75, hi: 115 }])).toEqual([
      { lo: 0, hi: 75 },
      { lo: 115, hi: 300 },
    ]);
    expect(subtractSpans({ lo: 0, hi: 300 }, [{ lo: -10, hi: 400 }])).toEqual([]);
    expect(subtractSpans({ lo: 0, hi: 300 }, [])).toEqual([{ lo: 0, hi: 300 }]);
  });
});

describe("manual placements survive a recompute", () => {
  it("keeps the hand-edited panel exactly where the user put it", () => {
    const { edited, placements } = withManualEdit(rectangleWalls(), { panelType: "R40", width: 40 });
    const recomputed = tileProject(projectOf(rectangleWalls(), placements)).placements;

    const kept = recomputed.find((p) => p.id === edited.id);
    expect(kept).toEqual({ ...edited, flags: [] });
  });

  it("re-tiles the automatic panels on the same edge around it, with no hole and no overlap", () => {
    const { edgeId, lo, hi, edited, placements, first } = withManualEdit(rectangleWalls(), {
      panelType: "R40",
      width: 40,
    });
    const recomputed = tileProject(projectOf(rectangleWalls(), placements)).placements;
    const row = runItems(recomputed, edgeId, "faceA");

    expectContinuous(row, lo, hi);
    const autos = row.filter((p) => p.source === "auto");
    expect(autos.length).toBeGreaterThan(0);
    // The automatic neighbours were chosen again, not carried over from the first compute.
    const firstIds = new Set(first.map((p) => p.id));
    expect(autos.some((p) => !firstIds.has(p.id))).toBe(true);
    expect(row.filter((p) => p.source === "manual")).toEqual([{ ...edited, flags: [] }]);
  });

  it("counts the manual panel in the bill of materials", () => {
    const { placements } = withManualEdit(rectangleWalls(), { panelType: "R40", width: 40 });
    const recomputed = tileProject(projectOf(rectangleWalls(), placements)).placements;
    const manualR40 = recomputed.filter((p) => p.source === "manual" && p.panelType === "R40").length;

    expect(manualR40).toBe(1);
    const counts = countPanels(recomputed);
    expect(counts.byType["R40"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.byType["R40"]).toBe(recomputed.filter((p) => p.panelType === "R40").length);
  });

  it("with the synced twin edited too, both faces keep the manual panel and stay aligned", () => {
    const walls = doubleContourRoomWalls();
    const { edgeId, edited, placements, first } = withManualEdit(walls, { panelType: "R40", width: 40 });
    // What update-placement does in the app: the opposite-face twin gets the same edit.
    const twin = first.find(
      (p) =>
        p.edgeId === edgeId &&
        p.side === "faceB" &&
        p.kind === "panel" &&
        p.offsetAlongEdge === edited.offsetAlongEdge
    )!;
    const both = placements.map((p) =>
      p.id === twin.id ? { ...p, panelType: "R40", width: 40, source: "manual" as const } : p
    );
    const { placements: recomputed, layout } = tileProject(projectOf(walls, both));

    const rowA = runItems(recomputed, edgeId, "faceA");
    const rowB = runItems(recomputed, edgeId, "faceB");
    const firstA = runItems(first, edgeId, "faceA");
    const firstB = runItems(first, edgeId, "faceB");
    const end = (row: Placement[]) => Math.round(row[row.length - 1]!.offsetAlongEdge + row[row.length - 1]!.width);
    expectContinuous(rowA, Math.round(firstA[0]!.offsetAlongEdge), end(firstA));
    expectContinuous(rowB, Math.round(firstB[0]!.offsetAlongEdge), end(firstB));

    // Across the stretch both faces share, every seam lines up through the wall.
    const sharedLo = Math.max(Math.round(rowA[0]!.offsetAlongEdge), Math.round(rowB[0]!.offsetAlongEdge));
    const sharedHi = Math.min(end(rowA), end(rowB));
    const seams = (row: Placement[]) =>
      row.map((p) => Math.round(p.offsetAlongEdge)).filter((s) => s > sharedLo && s < sharedHi);
    expect(seams(rowB)).toEqual(seams(rowA));
    expect(layout.diagnostics.map((d) => d.code)).not.toContain("manual-opposite-face-bare");
  });

  it("with a manual panel on one face only, leaves the far face bare there AND says so", () => {
    const walls = doubleContourRoomWalls();
    const { edgeId, edited, placements } = withManualEdit(walls, { panelType: "R40", width: 40 });
    const { placements: recomputed, layout } = tileProject(projectOf(walls, placements));
    const lo = Math.round(edited.offsetAlongEdge);
    const hi = lo + 40;

    const intrudes = runItems(recomputed, edgeId, "faceB").filter(
      (p) => Math.round(p.offsetAlongEdge) < hi && Math.round(p.offsetAlongEdge + p.width) > lo
    );
    expect(intrudes).toEqual([]);
    const bare = layout.diagnostics.filter((d) => d.code === "manual-opposite-face-bare");
    expect(bare).toHaveLength(1);
    expect(bare[0]!.message).toContain("40 ס״מ");
  });

  it("gives the same result when computed twice", () => {
    const { placements } = withManualEdit(rectangleWalls(), { panelType: "R40", width: 40 });
    const once = tileProject(projectOf(rectangleWalls(), placements)).placements;
    const twice = tileProject(projectOf(rectangleWalls(), once)).placements;
    expect(twice).toEqual(once);
  });

  it("never lets a regenerated id collide with a manual one", () => {
    const { placements } = withManualEdit(rectangleWalls(), { panelType: "R40", width: 40 });
    const recomputed = tileProject(projectOf(rectangleWalls(), placements)).placements;
    const ids = recomputed.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws stock for the manual panel before the automatic fill", () => {
    const { placements } = withManualEdit(rectangleWalls(), { panelType: "R40", width: 40 });
    // Exactly one R40 on the shelf: the manual one must take it.
    const inventory = Object.fromEntries(DEFAULT_PANEL_CATALOG.panels.map((p) => [p.bomLabel, 99]));
    inventory["פנאל 40/300"] = 1;
    const recomputed = tileProject(projectOf(rectangleWalls(), placements, inventory)).placements;

    const manual = recomputed.find((p) => p.source === "manual")!;
    expect(manual.flags).toEqual([]);
    const autoR40 = recomputed.filter((p) => p.source === "auto" && p.panelType === "R40");
    for (const p of autoR40) expect(p.flags).toContain("inventory-shortage");
  });

  it("flags a manual panel the stock cannot supply", () => {
    const { placements } = withManualEdit(rectangleWalls(), { panelType: "R40", width: 40 });
    const inventory = Object.fromEntries(DEFAULT_PANEL_CATALOG.panels.map((p) => [p.bomLabel, 99]));
    inventory["פנאל 40/300"] = 0;
    const { placements: recomputed, layout } = tileProject(projectOf(rectangleWalls(), placements, inventory));

    expect(recomputed.find((p) => p.source === "manual")!.flags).toEqual(["inventory-shortage"]);
    expect(layout.diagnostics.map((d) => d.code)).toContain("inventory-straight-panel-shortage");
  });

  it("spends finite stock between separate free spans around a manual panel", () => {
    const edge: Edge = {
      id: "edge:w",
      wallId: "w",
      nodeA: "a",
      nodeB: "b",
      clearLength: 190,
      flags: [],
    };
    const manual: Placement = {
      id: "manual",
      edgeId: edge.id,
      wallId: "w",
      pourId: "pour-1",
      side: "faceA",
      faceIsInterior: true,
      kind: "panel",
      panelType: "R40",
      offsetAlongEdge: 75,
      width: 40,
      source: "manual",
      flags: [],
    };
    const availability = Object.fromEntries(DEFAULT_PANEL_CATALOG.panels.map((p) => [p.type, 0]));
    availability["R75"] = 1;

    const result = tileWallPair({
      edge,
      wallId: "w",
      pourId: "pour-1",
      faces: [{ side: "faceA", faceIsInterior: true, startOffset: 0, clearLength: 190 }],
      catalog: DEFAULT_PANEL_CATALOG,
      rules: DEFAULT_ACCESSORY_RULES,
      availability,
      blocked: blockedSpansFor([manual]),
      manualPlacements: [manual],
    });

    const r75 = result.placements.filter((p) => p.panelType === "R75");
    expect(r75).toHaveLength(2);
    expect(r75.filter((p) => p.flags.includes("inventory-shortage"))).toHaveLength(1);
  });
});

describe("manual placements that cannot be kept are reported, not silently lost", () => {
  it("drops a manual placement whose wall no longer exists", () => {
    const { placements, edited } = withManualEdit(rectangleWalls(), { panelType: "R40", width: 40 });
    const walls = rectangleWalls().filter((w) => `edge:${w.id}` !== edited.edgeId);
    const { placements: recomputed, layout } = tileProject(projectOf(walls, placements));

    expect(recomputed.some((p) => p.id === edited.id)).toBe(false);
    const dropped = layout.diagnostics.filter((d) => d.code === "manual-placement-dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.wallIds).toEqual([edited.wallId]);
  });

  it.each([
    ["outside the run", -100],
    ["at a fractional centimetre", 10.4],
  ])("drops a manual placement %s instead of counting invalid geometry", (_case, offsetAlongEdge) => {
    const { placements, edited } = withManualEdit(rectangleWalls(), {
      panelType: "R40",
      width: 40,
      offsetAlongEdge,
    });
    const { placements: recomputed, layout } = tileProject(projectOf(rectangleWalls(), placements));

    expect(recomputed.some((p) => p.id === edited.id)).toBe(false);
    expect(layout.diagnostics.map((d) => d.code)).toContain("manual-placement-dropped");
  });

  it("re-derives a hand-swapped corner panel instead of keeping it next to the automatic one", () => {
    const first = tileProject(projectOf(rectangleWalls())).placements;
    const corner = first.find((p) => p.kind === "corner-panel")!;
    const placements = first.map((p) => (p.id === corner.id ? { ...p, source: "manual" as const } : p));
    const { placements: recomputed, layout } = tileProject(projectOf(rectangleWalls(), placements));

    expect(recomputed.filter((p) => p.id === corner.id)).toHaveLength(1);
    expect(recomputed.find((p) => p.id === corner.id)!.source).toBe("auto");
    expect(layout.diagnostics.map((d) => d.code)).toContain("manual-placement-dropped");
  });
});
