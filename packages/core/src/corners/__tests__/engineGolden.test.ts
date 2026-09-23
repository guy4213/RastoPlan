import { describe, expect, it } from "vitest";
import type { Edge, Project, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { countAccessoriesByPour, countPanelsByPour } from "../../accessories/countByPour.js";
import * as fixtures from "../../geometry/__tests__/fixtures.js";
import { REFERENCE_FACE_SPANS } from "../../tiling/__tests__/referenceFaceSpans.js";
import { tileWallPair } from "../../tiling/tileWallPair.js";
import { tileProject } from "../tileProject.js";

/**
 * Golden regression guard for changes that must NOT move quantities.
 *
 * The snapshot was recorded from the engine before the manual-placement work
 * (Phase C, stage 1.2). Any later change that alters placements, diagnostics or
 * per-pour counts for a project WITHOUT manual placements fails here. A
 * separate sentinel below also enters the manual-placement branch and proves
 * an unchanged manual panel keeps the same physical counts. Update a snapshot
 * only for an approved quantity-changing rule, and report the diff.
 */

const WALL_FIXTURES: Record<string, () => Wall[]> = {
  rectangle: fixtures.rectangleWalls,
  rectangleMixedThickness: fixtures.rectangleWallsMixedThickness,
  rectangleWithJitter: fixtures.rectangleWallsWithJitter,
  lShape: fixtures.lShapeWalls,
  tJunction: fixtures.tJunctionWalls,
  doubleContourRoom: fixtures.doubleContourRoomWalls,
  doubleContourRoomMixedDirection: fixtures.doubleContourRoomWallsMixedDirection,
  roomWithInteriorWall: fixtures.roomWithInteriorWallWalls,
  slightlySkewedRoom: fixtures.slightlySkewedRoomWalls,
  lShapedPartition: fixtures.lShapedPartitionWalls,
  collinearSplitWall: fixtures.collinearSplitWallWalls,
  doubleContourLShape: fixtures.doubleContourLShapeWalls,
  nestedRooms: fixtures.nestedRoomsWalls,
  twoPourDoubleContour: fixtures.twoPourDoubleContourWalls,
};

function projectFor(walls: Wall[], inventory?: Record<string, number>): Project {
  const pourIds = [...new Set(walls.map((w) => w.pourId))].sort();
  return {
    id: "golden",
    name: "golden",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: pourIds.map((id, order) => ({
      id,
      name: `יציקה ${order + 1}`,
      color: "#000000",
      order,
      defaultThicknessCm: 20,
    })),
    walls,
    placements: [],
    schemaVersion: 3,
    ...(inventory ? { inventory } : {}),
  };
}

function summarise(project: Project) {
  const { placements, layout } = tileProject(project);
  return {
    placements: placements.map((p) =>
      [p.id, p.kind, p.panelType, p.side, p.faceIsInterior, p.offsetAlongEdge, p.width, p.groupId ?? "", p.flags.join("+")].join("|")
    ),
    diagnostics: layout.diagnostics.map((d) => `${d.code}|${d.severity}|${d.wallIds.join(",")}`),
    panels: countPanelsByPour(placements, project.walls),
    accessories: countAccessoriesByPour(placements, layout.edges, project.walls, project.rules),
  };
}

// A deliberately short stock so the finite-inventory ledger path is exercised too.
const SHORT_STOCK: Record<string, number> = {
  "פנאל 75/300": 6,
  "פנאל 40/300": 2,
  "פנאל 30/30/300": 3,
};

describe("engine golden output (no manual placements)", () => {
  for (const [name, walls] of Object.entries(WALL_FIXTURES)) {
    it(`${name}: unlimited stock`, () => {
      expect(summarise(projectFor(walls()))).toMatchSnapshot();
    });
    it(`${name}: finite stock`, () => {
      expect(summarise(projectFor(walls(), SHORT_STOCK))).toMatchSnapshot();
    });
  }

  it("enters the manual-placement path without changing an untouched panel or the quantities", () => {
    const project = projectFor(fixtures.rectangleWalls());
    const before = tileProject(project);
    const target = before.placements.find((p) => p.kind === "panel")!;
    const withManual: Project = {
      ...project,
      placements: before.placements.map((p) =>
        p.id === target.id ? { ...p, source: "manual" as const } : p
      ),
    };

    const after = tileProject(withManual);
    expect(after.placements.find((p) => p.id === target.id)?.source).toBe("manual");
    expect(countPanelsByPour(after.placements, project.walls)).toEqual(
      countPanelsByPour(before.placements, project.walls)
    );
    expect(countAccessoriesByPour(after.placements, after.layout.edges, project.walls, project.rules)).toEqual(
      countAccessoriesByPour(before.placements, before.layout.edges, project.walls, project.rules)
    );
  });

  it("166 reference face spans", () => {
    const edge: Edge = { id: "edge:1", wallId: "wall:1", nodeA: "n0", nodeB: "n1", clearLength: 0, flags: [] };
    const rows = REFERENCE_FACE_SPANS.map(([aLo, aHi, bLo, bHi]) => {
      const { placements, diagnostics } = tileWallPair({
        edge,
        wallId: "wall:1",
        pourId: "pour-1",
        faces: [
          { side: "faceA", faceIsInterior: true, startOffset: aLo, clearLength: aHi - aLo },
          { side: "faceB", faceIsInterior: false, startOffset: bLo, clearLength: bHi - bLo },
        ],
        catalog: DEFAULT_PANEL_CATALOG,
        rules: DEFAULT_ACCESSORY_RULES,
      });
      const row = placements
        .map((p) => `${p.side}:${p.panelType || p.kind}@${p.offsetAlongEdge}+${p.width}${p.flags.length ? `[${p.flags.join("+")}]` : ""}`)
        .join(" ");
      return `${aLo},${aHi},${bLo},${bHi} => ${row} ${diagnostics.map((d) => d.code).join(",")}`;
    });
    expect(rows).toMatchSnapshot();
  });
});
