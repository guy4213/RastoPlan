import { describe, expect, it } from "vitest";
import type { Placement, Point, Pour, Project, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { countPanels } from "../../accessories/countPanels.js";
import {
  doubleContourRoomWallsAt,
  nestedRoomsWalls,
  rectangleWallsAt,
} from "../../geometry/__tests__/fixtures.js";
import { tileProject, tileProjectPlacements } from "../../corners/tileProject.js";
import { resolveWalls } from "../resolveWalls.js";

/**
 * Every thickness here used to be broken. The old 15cm floor refused to pair
 * anything below it, so a thin wall came back as two independent walls with two
 * full sets of formwork — in the drawing AND in the bill of materials.
 */
const THICKNESSES = [5, 8, 10, 12, 20, 40];

const pour: Pour = { id: "pour-1", name: "יציקה 1", color: "#000", order: 0 };

function projectOf(walls: Wall[]): Project {
  return {
    id: "proj-1",
    name: "test",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [pour],
    walls,
    placements: [],
  };
}

function tile(walls: Wall[]): Placement[] {
  return tileProjectPlacements(projectOf(walls));
}

/** Where a placement physically sits, as a key: same key twice = doubled formwork. */
function footprintOf(placement: Placement): string {
  return [
    placement.edgeId,
    placement.side,
    placement.offsetAlongEdge.toFixed(2),
    placement.width.toFixed(2),
  ].join("|");
}

describe("wall thickness — the two contours are one wall at any thickness", () => {
  it.each(THICKNESSES)("pairs both contours of a %icm wall into one", (thickness) => {
    const result = resolveWalls(doubleContourRoomWallsAt(thickness));

    expect(result.resolvedWalls).toHaveLength(4);
    expect(result.consumedWallIds.size).toBe(4);
    expect([...result.consumedWallIds].sort()).toEqual([
      "out-bottom",
      "out-left",
      "out-right",
      "out-top",
    ]);
  });

  it.each(THICKNESSES)("reads %icm back off the drawing as the thickness", (thickness) => {
    for (const wall of resolveWalls(doubleContourRoomWallsAt(thickness)).resolvedWalls) {
      expect(wall.thicknessSource).toBe("measured");
      expect(wall.thickness).toBe(thickness);
      expect(wall.faceBOffsetCm).toBe(thickness);
    }
  });

  it.each(THICKNESSES)(
    "tiles both actually drawn faces of a %icm two-contour room exactly once",
    (thickness) => {
      const twoContours = tile(doubleContourRoomWallsAt(thickness));
      const oneContour = tile(rectangleWallsAt(thickness));

      expect(new Set(twoContours.map((placement) => placement.side))).toEqual(
        new Set(["faceA", "faceB"])
      );
      expect(new Set(oneContour.map((placement) => placement.side))).toEqual(new Set(["faceA"]));
      expect(
        Object.values(countPanels(twoContours).byType).reduce((sum, count) => sum + count, 0)
      ).toBeGreaterThan(
        Object.values(countPanels(oneContour).byType).reduce((sum, count) => sum + count, 0)
      );
    }
  );

  it.each(THICKNESSES)("emits no duplicate placement at %icm", (thickness) => {
    const placements = tile(doubleContourRoomWallsAt(thickness));

    const ids = placements.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Two different placements on the same stretch of the same face is the
    // signature of the doubling bug even when the ids happen to differ.
    const footprints = placements.map(footprintOf);
    expect(new Set(footprints).size).toBe(footprints.length);
  });

  it.each(THICKNESSES)("tiles only the walls that were not consumed at %icm", (thickness) => {
    const project = projectOf(doubleContourRoomWallsAt(thickness));
    const { layout, placements } = tileProject(project);

    const tiledWallIds = new Set(placements.map((p) => p.wallId));
    const consumed = new Set(layout.resolvedWalls.flatMap((w) => w.consumedWallIds));

    for (const id of tiledWallIds) expect(consumed.has(id)).toBe(false);
    // struts and rods read layout.edges — a consumed edge left in there is a
    // second helping of both.
    expect(layout.edges).toHaveLength(4);
  });

  it("keeps sub-centimetre precision instead of rounding the geometry", () => {
    // 12.4cm quantizes to 12.4, not to 12. Rounding here would shift the far
    // face by 4mm every time the engine ran.
    for (const wall of resolveWalls(doubleContourRoomWallsAt(12.4)).resolvedWalls) {
      expect(wall.thickness).toBe(12.4);
      expect(wall.faceBOffsetCm).toBe(12.4);
    }
  });

  it("does not double the quantities of a thin wall", () => {
    // The regression in its plainest form: 10cm used to fall under the floor.
    const thin = countPanels(tile(doubleContourRoomWallsAt(10)));
    const thick = countPanels(tile(doubleContourRoomWallsAt(30)));
    const total = (byType: Record<string, number>) =>
      Object.values(byType).reduce((sum, n) => sum + n, 0);

    expect(total(thin.byType)).toBeLessThan(total(thick.byType) * 1.5);
  });
});

describe("wall thickness — what the declared thickness may and may not override", () => {
  it("accepts a separation the user typed even outside the plausible band", () => {
    const walls = doubleContourRoomWallsAt(6).map((w) => ({ ...w, thickness: 6 }));

    const result = resolveWalls(walls, { minThicknessCm: 15 });
    const confirmed = resolveWalls(walls);

    // An explicitly requested floor is an instruction and still wins...
    expect(result.resolvedWalls).toHaveLength(8);
    // ...but the default band yields to a thickness the engineer actually typed.
    expect(confirmed.resolvedWalls).toHaveLength(4);
  });

  it("cannot override parallelism", () => {
    const walls = doubleContourRoomWallsAt(20);
    const skewed = walls.map((w) =>
      w.id === "out-bottom"
        ? { ...w, innerLine: [{ x: -20, y: -20 }, { x: 420, y: -60 }] as [Wall["innerLine"][0], Wall["innerLine"][1]] }
        : w
    );

    const pairedIds = resolveWalls(skewed).consumedWallIds;
    expect(pairedIds.has("out-bottom")).toBe(false);
  });

  it("cannot override an uneven separation", () => {
    const walls = doubleContourRoomWallsAt(20).map((w) =>
      // 20 at one end, 26 at the other: the typed 20 matches the mean, but the
      // two lines are not a constant distance apart, so they are not one wall.
      w.id === "out-bottom"
        ? { ...w, innerLine: [{ x: -20, y: -17 }, { x: 420, y: -26 }] as [Wall["innerLine"][0], Wall["innerLine"][1]] }
        : w
    );

    expect(resolveWalls(walls).consumedWallIds.has("out-bottom")).toBe(false);
  });

  it("cannot override belonging to the same pour", () => {
    const walls = doubleContourRoomWallsAt(20).map((w) =>
      w.id.startsWith("out-") ? { ...w, pourId: "pour-2" } : w
    );
    const result = resolveWalls(walls);

    expect(result.consumedWallIds.size).toBe(0);
    expect(result.resolvedWalls).toHaveLength(8);
    expect(result.diagnostics.some((d) => d.code === "contour-pairing-failed")).toBe(true);
  });
});

describe("wall thickness — failures are never silent", () => {
  it("reports a pair that looked like one wall and was turned down", () => {
    const walls = doubleContourRoomWallsAt(20).map((w) =>
      w.id.startsWith("out-") ? { ...w, pourId: "pour-2" } : w
    );

    const failure = resolveWalls(walls).diagnostics.find(
      (d) => d.code === "contour-pairing-failed"
    );

    expect(failure?.severity).toBe("warning");
    expect(failure?.message).toContain("יציקות שונות");
    expect(failure?.wallIds).toHaveLength(2);
  });

  it("refuses, loudly, a wall thinner than the graph can resolve", () => {
    const diagnostic = resolveWalls(doubleContourRoomWallsAt(3)).diagnostics.find(
      (d) => d.code === "wall-below-geometry-resolution"
    );

    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.wallIds).toHaveLength(2);
  });

  it("stays quiet about a free-standing room inside a hall", () => {
    // Nested contours with low pairing coverage are a legal plan, not a failed
    // wall. Warning here would cry wolf on every courtyard.
    const diagnostics = resolveWalls(nestedRoomsWalls(), { maxThicknessCm: 50 }).diagnostics;

    expect(diagnostics.some((d) => d.code === "contour-pairing-failed")).toBe(false);
  });

  it("stays quiet on a plain single-contour room", () => {
    const diagnostics = resolveWalls(rectangleWallsAt(20)).diagnostics;

    expect(diagnostics.some((d) => d.code === "contour-pairing-failed")).toBe(false);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
  });
});

describe("wall thickness — a thick wall must pair just as readily as a thin one", () => {
  /** A room traced as two contours whose gap differs per axis, as drawn plans do. */
  function unevenRoom(sideGapCm: number, endGapCm: number): Wall[] {
    const w = 960;
    const h = 800;
    const ring = (x0: number, y0: number, x1: number, y1: number, prefix: string): Wall[] => {
      const pts = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      return pts.map((p, i) => ({
        id: `${prefix}-${i}`,
        pourId: "pour-1",
        innerLine: [p, pts[(i + 1) % pts.length]!] as [Point, Point],
        thickness: 20,
      }));
    };
    return [
      ...ring(0, 0, w, h, "out"),
      ...ring(sideGapCm, endGapCm, w - sideGapCm, h - endGapCm, "in"),
    ];
  }

  it("pairs a plan traced far apart, instead of tiling both contours", () => {
    // A real plan that came back doubled: the two contours sat 164.5cm and
    // 206cm apart, over a thickness ceiling that had been added to keep a
    // half-finished drawing from pairing across a room. The ceiling refused
    // this, so neither contour was consumed and every wall was tiled twice —
    // the exact failure this whole layer exists to prevent.
    const result = resolveWalls(unevenRoom(164.5, 206));

    expect(result.resolvedWalls).toHaveLength(4);
    expect(result.consumedWallIds.size).toBe(4);
  });

  it("measures each side of such a plan at its own gap", () => {
    const byId = new Map(
      resolveWalls(unevenRoom(164.5, 206)).resolvedWalls.map((w) => [w.id, w])
    );

    // The horizontal runs are held apart by the vertical gap and vice versa.
    expect(byId.get("in-0")?.thickness).toBe(206);
    expect(byId.get("in-1")?.thickness).toBe(164.5);
    for (const wall of byId.values()) expect(wall.faceBOffsetCm).toBe(wall.thickness);
  });

  it("still emits no duplicate placement at that scale", () => {
    const placements = tile(unevenRoom(164.5, 206));
    const footprints = placements.map(footprintOf);

    expect(new Set(footprints).size).toBe(footprints.length);
  });
});
