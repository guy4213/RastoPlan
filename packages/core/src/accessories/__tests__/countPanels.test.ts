import { describe, expect, it } from "vitest";
import type { Placement } from "../../types.js";
import { doubleContourRoomWalls, rectangleWalls } from "../../geometry/__tests__/fixtures.js";
import { tileProject } from "../../corners/tileProject.js";
import { countPanels, countPanelsByFace } from "../countPanels.js";
import { projectOf } from "./fixtures.js";

function synthetic(overrides: Partial<Placement>): Placement {
  return {
    id: "p",
    edgeId: "e",
    wallId: "w",
    pourId: "pour-1",
    side: "faceA",
    faceIsInterior: true,
    kind: "panel",
    panelType: "R75",
    offsetAlongEdge: 0,
    width: 75,
    source: "auto",
    flags: [],
    ...overrides,
  };
}

describe("countPanels", () => {
  it("groups by panelType across both faces (each is a distinct physical panel)", () => {
    const { placements } = tileProject(projectOf(rectangleWalls()));
    const panels = countPanels(placements);
    // The auto-tile picks whichever combo the priority order surfaces; the
    // stable invariant is that both faces count together, so every straight
    // type count is even. Corner panels collapse to one unit per corner and
    // are the deliberate exception.
    for (const [type, n] of Object.entries(panels.byType)) {
      if (type.startsWith("C")) continue;
      expect(n % 2, `type=${type}`).toBe(0);
    }
    // R75 is leading and heavily used at these lengths; at least some
    // must be present.
    expect(panels.byType.R75 ?? 0).toBeGreaterThan(0);
  });

  it("excludes outer-corner-protrusion markers from the panel count (they're overhangs, not distinct panels)", () => {
    const { placements } = tileProject(projectOf(rectangleWalls()));
    const withProtrusions = countPanels(placements);
    const strippedProtrusions = countPanels(
      placements.filter((p) => !p.flags.includes("outer-corner-protrusion"))
    );
    expect(withProtrusions).toEqual(strippedProtrusions);
  });

  it("sums timber pieces AND total timber length in cm", () => {
    const placements: Placement[] = [
      synthetic({ id: "t1", kind: "timber", panelType: "", width: 7 }),
      synthetic({ id: "t2", kind: "timber", panelType: "", width: 8, side: "faceB" }),
      synthetic({ id: "r1", panelType: "R60", width: 60 }),
    ];
    const panels = countPanels(placements);
    expect(panels.timberPieces).toBe(2);
    expect(panels.timberLengthCm).toBe(15);
    expect(panels.byType.R60).toBe(1);
  });

  it("returns empty structure for an empty placement list", () => {
    expect(countPanels([])).toEqual({ byType: {}, timberPieces: 0, timberLengthCm: 0 });
  });
});

describe("countPanelsByFace", () => {
  it("partitions every panel type and timber total while preserving the legacy total", () => {
    const walls = doubleContourRoomWalls();
    const { placements } = tileProject(projectOf(walls));
    const counts = countPanelsByFace(placements, walls);

    for (const type of new Set([
      ...Object.keys(counts.interior.byType),
      ...Object.keys(counts.exterior.byType),
    ])) {
      expect((counts.interior.byType[type] ?? 0) + (counts.exterior.byType[type] ?? 0)).toBe(
        counts.total.byType[type] ?? 0
      );
    }
    expect(counts.interior.timberPieces + counts.exterior.timberPieces).toBe(
      counts.total.timberPieces
    );
    expect(counts.interior.timberLengthCm + counts.exterior.timberLengthCm).toBe(
      counts.total.timberLengthCm
    );
    expect(counts.total).toEqual(countPanels(placements));
  });

  it("counts a grouped corner once and uses its canonical representative's face bucket", () => {
    const legs = [
      synthetic({
        id: "corner-a",
        groupId: "corner:1",
        kind: "corner-panel",
        panelType: "C30x30",
        faceIsInterior: true,
      }),
      synthetic({
        id: "corner-b",
        groupId: "corner:1",
        kind: "corner-panel",
        panelType: "C30x30",
        faceIsInterior: false,
        side: "faceB",
      }),
    ];

    const counts = countPanelsByFace(legs, []);
    expect(counts.interior.byType.C30x30).toBe(1);
    expect(counts.exterior.byType.C30x30 ?? 0).toBe(0);
    expect(counts.total.byType.C30x30).toBe(1);
  });

  it("has no exterior bucket for a single-contour rectangle", () => {
    const walls = rectangleWalls();
    const { placements } = tileProject(projectOf(walls));
    expect(countPanelsByFace(placements, walls).exterior).toEqual({
      byType: {},
      timberPieces: 0,
      timberLengthCm: 0,
    });
  });

  it("populates both buckets for a double-contour rectangle", () => {
    const walls = doubleContourRoomWalls();
    const { placements } = tileProject(projectOf(walls));
    const counts = countPanelsByFace(placements, walls);
    expect(Object.values(counts.interior.byType).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0);
    expect(Object.values(counts.exterior.byType).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0);
  });
});
