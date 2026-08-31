import { describe, expect, it } from "vitest";
import type { Placement, PlacementSide, Pour, Project, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { countPanels } from "../../accessories/countPanels.js";
import { countAccessories } from "../../accessories/countAccessories.js";
import { countCornerUnits } from "../../accessories/units.js";
import { deriveOuterLine } from "../deriveOuterLine.js";
import {
  collinearSplitWallWalls,
  doubleContourLShapeWalls,
  doubleContourRoomWalls,
  doubleContourRoomWallsMixedDirection,
  lShapeWalls,
  rectangleWalls,
  roomWithInteriorWallWalls,
  slightlySkewedRoomWalls,
} from "../../geometry/__tests__/fixtures.js";
import { tileProject, tileProjectPlacements } from "../tileProject.js";

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

describe("tileProject — the customer's two-contour drawing", () => {
  it("tiles each drawn contour once, while a single drawn contour stays one row", () => {
    const twoContours = tile(doubleContourRoomWalls());
    const oneContour = tile(rectangleWalls());

    expect(new Set(twoContours.map((placement) => placement.side))).toEqual(
      new Set(["faceA", "faceB"])
    );
    expect(new Set(oneContour.map((placement) => placement.side))).toEqual(new Set(["faceA"]));

    const footprints = twoContours.map((placement) =>
      [
        placement.edgeId,
        placement.side,
        placement.offsetAlongEdge.toFixed(2),
        placement.width.toFixed(2),
      ].join("|")
    );
    expect(new Set(footprints).size).toBe(footprints.length);
  });

  it("never places anything on a wall that was only the far face of another", () => {
    const project = projectOf(doubleContourRoomWalls());
    const { placements, layout } = tileProject(project);
    const consumed = new Set(layout.resolvedWalls.flatMap((w) => w.consumedWallIds));

    expect(consumed.size).toBe(4);
    for (const placement of placements) {
      expect(consumed.has(placement.wallId)).toBe(false);
    }
  });

  it("adds panel clamps for the second drawn face without duplicating wall-level accessories", () => {
    const two = projectOf(doubleContourRoomWalls());
    const one = projectOf(rectangleWalls());
    const twoResult = tileProject(two);
    const oneResult = tileProject(one);

    const count = (r: typeof twoResult, p: Project) =>
      countAccessories(r.placements, r.layout.edges, p.walls, DEFAULT_ACCESSORY_RULES);

    const twoCount = count(twoResult, two);
    const oneCount = count(oneResult, one);

    expect(twoCount.straightClamps).toBeGreaterThan(oneCount.straightClamps);
    expect(twoCount.cornerClamps).toBe(oneCount.cornerClamps);
    expect(twoCount.dywidagRods).toBe(oneCount.dywidagRods);
    expect(twoCount.nuts).toBe(oneCount.nuts);
    expect(twoCount.struts).toBe(oneCount.struts);
    // Consumed contour edges still stay out of the wall-level counters.
    expect(twoResult.layout.edges).toHaveLength(4);
  });

  it("keeps the corner and clamp counts identical to the one-contour room", () => {
    const two = tile(doubleContourRoomWalls());
    const one = tile(rectangleWalls());

    expect(countCornerUnits(two)).toBe(4);
    expect(countCornerUnits(two)).toBe(countCornerUnits(one));
    expect(two.filter((p) => p.kind === "corner-panel")).toHaveLength(8);
  });

  it("is unaffected by which way the individual walls were dragged", () => {
    const straight = countPanels(tile(doubleContourRoomWalls()));
    const mixed = countPanels(tile(doubleContourRoomWallsMixedDirection()));

    expect(mixed.byType).toEqual(straight.byType);
    expect(mixed.timberPieces).toBe(straight.timberPieces);
  });

  it("handles the two-contour L-shape as one six-wall ring", () => {
    const project = projectOf(doubleContourLShapeWalls());
    const { placements, layout } = tileProject(project);
    const exteriorCornerLegs = placements.filter(
      (placement) => placement.kind === "corner-panel" && !placement.faceIsInterior
    );

    // Six physical walls still form the ring. The seventh corner unit is the
    // approved C30x30 on the exterior face of the re-entrant building corner.
    expect(countCornerUnits(placements)).toBe(7);
    expect(new Set(placements.map((p) => p.wallId)).size).toBe(6);
    expect(exteriorCornerLegs).toHaveLength(2);
    expect(new Set(exteriorCornerLegs.map((placement) => placement.groupId)).size).toBe(1);
    expect(exteriorCornerLegs.every((placement) => placement.side === "faceB")).toBe(true);
    expect(
      exteriorCornerLegs.every((placement) => placement.groupId?.endsWith(":region:outside"))
    ).toBe(true);
    expect(
      placements.filter((placement) =>
        placement.flags.includes("face-alignment-remainder")
      )
    ).toHaveLength(0);
    expect(
      layout.diagnostics.filter(
        (diagnostic) => diagnostic.code === "face-alignment-remainder"
      )
    ).toHaveLength(0);
    expect(
      placements.some(
        (placement) =>
          placement.edgeId === "edge:in-3" &&
          placement.side === "faceA" &&
          placement.panelType === "R20"
      )
    ).toBe(true);
  });

  it("adds one C30x30 without changing the independently derived K30 count", () => {
    const project = projectOf(doubleContourLShapeWalls());
    const result = tileProject(project);
    const panels = countPanels(result.placements);
    const accessories = countAccessories(
      result.placements,
      result.layout.edges,
      project.walls,
      project.rules,
      result.layout.externalCorners
    );

    expect(panels.byType.C30x30).toBe(7);
    expect(result.layout.externalCorners).toHaveLength(5);
    expect(accessories.cornerClamps).toBe(15);
  });

  it("raises no unexpected flags", () => {
    for (const p of tile(doubleContourRoomWalls())) {
      const unexpected = p.flags.filter((f) => f !== "outer-corner-protrusion");
      expect(unexpected, `wall=${p.wallId} side=${p.side}`).toHaveLength(0);
    }
  });
});

describe("tileProject — a wall drawn as two collinear segments", () => {
  it("does not invent a corner panel or its clamps at the seam", () => {
    const split = tile(collinearSplitWallWalls());
    const whole = tile(rectangleWalls());

    expect(countCornerUnits(split)).toBe(4);
    expect(countCornerUnits(whole)).toBe(4);

    const rules = DEFAULT_ACCESSORY_RULES;
    const splitCounts = countAccessories(
      split,
      layoutEdges(collinearSplitWallWalls()),
      collinearSplitWallWalls(),
      rules
    );
    expect(splitCounts.cornerClamps).toBe(12);
  });
});

describe("tileProject — a hand-drawn plan is never perfectly orthogonal", () => {
  it("tiles a room whose walls are a few millimetres off axis", () => {
    const placements = tile(slightlySkewedRoomWalls());

    expect(placements.some((p) => p.flags.includes("gap-out-of-range"))).toBe(false);
    expect(placements.filter((p) => p.kind === "panel").length).toBeGreaterThan(0);
    expect(countCornerUnits(placements)).toBe(4);
  });
});

describe("tileProject — a partition between two rooms", () => {
  it("tiles its drawn line once even though the wall borders two rooms", () => {
    const { placements } = tileProject(projectOf(roomWithInteriorWallWalls()));
    const partition = placements.filter((p) => p.wallId === "partition");

    expect(partition.length).toBeGreaterThan(0);
    expect(partition.every((p) => p.faceIsInterior)).toBe(true);
    expect(new Set(partition.map((p) => p.side))).toEqual(new Set(["faceA"]));
    expect(partition.some((p) => p.flags.includes("outer-corner-protrusion"))).toBe(false);
  });

  it("still reports four corner units at the box corners", () => {
    expect(countCornerUnits(tile(roomWithInteriorWallWalls()))).toBe(4);
  });
});

describe("tileProject — each drawn wall covers its run exactly once", () => {
  /** Panels butt end to end with no hole and no overlap across the whole run. */
  function assertContiguous(placements: Placement[], edgeId: string, side: PlacementSide) {
    const run = placements
      .filter((p) => p.edgeId === edgeId && p.side === side)
      .filter((p) => !p.flags.includes("outer-corner-protrusion"))
      .filter((p) => p.kind !== "corner-panel")
      .sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);

    expect(run.length, `${edgeId}/${side}`).toBeGreaterThan(0);
    for (let i = 0; i < run.length - 1; i++) {
      expect(run[i]!.offsetAlongEdge + run[i]!.width, `${edgeId}/${side} gap at ${i}`).toBe(
        run[i + 1]!.offsetAlongEdge
      );
    }
    return run;
  }

  it("tiles the drawn ring contiguously and emits nothing on the derived thickness face", () => {
    const placements = tile(rectangleWalls());

    for (const wallId of ["bottom", "right", "top", "left"]) {
      assertContiguous(placements, `edge:${wallId}`, "faceA");
      expect(
        placements.filter((p) => p.edgeId === `edge:${wallId}` && p.side === "faceB")
      ).toHaveLength(0);
    }
  });

  it("gives a paired two-contour wall one row on each drawn face", () => {
    const placements = tile(doubleContourRoomWalls());
    for (const wallId of ["in-bottom", "in-right", "in-top", "in-left"]) {
      assertContiguous(placements, `edge:${wallId}`, "faceA");
      assertContiguous(placements, `edge:${wallId}`, "faceB");
    }
  });

  it("leaves no untiled stretch on a room mixing 20cm and 30cm walls", () => {
    const walls: Wall[] = [
      {
        id: "bottom",
        pourId: "pour-1",
        innerLine: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ],
        thickness: 20,
      },
      {
        id: "right",
        pourId: "pour-1",
        innerLine: [
          { x: 300, y: 0 },
          { x: 300, y: 300 },
        ],
        thickness: 30,
      },
      {
        id: "top",
        pourId: "pour-1",
        innerLine: [
          { x: 300, y: 300 },
          { x: 0, y: 300 },
        ],
        thickness: 20,
      },
      {
        id: "left",
        pourId: "pour-1",
        innerLine: [
          { x: 0, y: 300 },
          { x: 0, y: 0 },
        ],
        thickness: 30,
      },
    ];
    const placements = tile(walls);

    for (const wallId of ["bottom", "right", "top", "left"]) {
      assertContiguous(placements, `edge:${wallId}`, "faceA");
      expect(
        placements.filter((p) => p.edgeId === `edge:${wallId}` && p.side === "faceB")
      ).toHaveLength(0);
    }
    for (const p of placements) {
      expect(p.flags.filter((f) => f !== "outer-corner-protrusion")).toHaveLength(0);
    }
  });
});

describe("tileProject — corners", () => {
  it("puts a corner panel on the room face and nothing extra on the outside", () => {
    const placements = tile(rectangleWalls());

    // No stray blocks in the corners: the outside is two straight panels.
    expect(placements.filter((p) => p.flags.includes("outer-corner-protrusion"))).toHaveLength(0);

    const cornerLegs = placements.filter((p) => p.kind === "corner-panel");
    expect(cornerLegs).toHaveLength(8);
    expect(cornerLegs.every((p) => p.side === "faceA")).toBe(true);
    expect(cornerLegs.every((p) => p.width === 30)).toBe(true);
  });

  it("keeps the derived outer face in geometry without emitting a second row", () => {
    const { layout } = tileProject(projectOf(rectangleWalls()));
    const placements = tile(rectangleWalls());
    const outerOf = (wallId: string) =>
      placements
        .filter((p) => p.edgeId === `edge:${wallId}` && p.side === "faceB")
        .sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);

    expect(outerOf("bottom")).toHaveLength(0);
    expect(outerOf("right")).toHaveLength(0);
    expect(layout.resolvedWalls.every((wall) => wall.faces[1].sourceWallId === undefined)).toBe(true);
    expect(layout.resolvedWalls).toHaveLength(4);
  });
});

describe("tileProject — corner panels", () => {
  it("L-shape: every corner gets a C30x30 on the room face, one leg per meeting wall", () => {
    const cornerPanels = tile(lShapeWalls()).filter((p) => p.kind === "corner-panel");

    // 6 corners × 2 meeting walls = 12 legs, 6 physical panels.
    expect(cornerPanels).toHaveLength(12);
    expect(new Set(cornerPanels.map((p) => p.groupId)).size).toBe(6);
    expect(cornerPanels.every((p) => p.panelType === "C30x30")).toBe(true);
    expect(cornerPanels.every((p) => p.side === "faceA")).toBe(true);

    // The notch walls each carry a leg at both of their ends.
    for (const wallId of ["w3", "w4"]) {
      expect(cornerPanels.filter((p) => p.edgeId === `edge:${wallId}`)).toHaveLength(2);
    }
  });
});

describe("tileProject — full pipeline coherence", () => {
  it("rectangular room: no unexpected failure flags on any placement", () => {
    for (const p of tile(rectangleWalls())) {
      const unexpected = p.flags.filter((f) => f !== "outer-corner-protrusion");
      expect(unexpected, `edge=${p.edgeId} side=${p.side}`).toHaveLength(0);
    }
  });

  it("returns exactly one panel side per resolved wall", () => {
    const placements = tile(rectangleWalls());
    expect(placements.some((p) => p.side === "faceA")).toBe(true);
    expect(placements.some((p) => p.side === "faceB")).toBe(false);
  });

  it("returns a layout describing what it decided", () => {
    const { layout } = tileProject(projectOf(doubleContourRoomWalls()));

    expect(layout.resolvedWalls).toHaveLength(4);
    expect(layout.corners).toHaveLength(4);
    expect(layout.regions.map((r) => r.kind).sort()).toEqual(["outside", "room", "wall-material"]);
    expect(layout.engineVersion).toBeGreaterThanOrEqual(2);
  });
});

describe("tileProject — finite imported inventory", () => {
  it("keeps a zero-stock design visible but flags every unavailable physical panel", () => {
    const project = projectOf(rectangleWalls());
    project.inventory = Object.fromEntries(
      project.catalog.panels.map((panel) => [panel.bomLabel, 0])
    );

    const { placements, layout } = tileProject(project);

    const panels = placements.filter(
      (placement) => placement.kind === "panel" || placement.kind === "corner-panel"
    );
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((placement) => placement.flags.includes("inventory-shortage"))).toBe(true);
    expect(layout.diagnostics.some((diagnostic) => diagnostic.code === "inventory-corner-panel-shortage")).toBe(true);
    expect(layout.diagnostics.some((diagnostic) => diagnostic.code === "inventory-straight-panel-shortage")).toBe(true);
  });

  it("uses exactly the five stocked R75 panels and marks only later R75 units as missing", () => {
    const project = projectOf(rectangleWalls());
    project.inventory = Object.fromEntries(
      project.catalog.panels.map((panel) => [panel.bomLabel, 0])
    );
    project.inventory["פנאל 75/300"] = 5;
    // The original inventory code persisted these flags as false. Finite
    // inventory must supersede that stale catalog state.
    project.catalog = {
      ...project.catalog,
      panels: project.catalog.panels.map((panel) => ({ ...panel, inStock: false })),
    };

    const { placements } = tileProject(project);
    const r75 = placements.filter((placement) => placement.panelType === "R75");

    expect(
      r75.filter((placement) => !placement.flags.includes("inventory-shortage"))
    ).toHaveLength(5);
    expect(
      r75.filter((placement) => placement.flags.includes("inventory-shortage")).length
    ).toBeGreaterThan(0);
  });
});

describe("tileProject — variable wall thickness", () => {
  it("deriveOuterLine offsets each wall by its own thickness (not a global constant)", () => {
    const thin: Wall = {
      id: "thin",
      pourId: "pour-1",
      innerLine: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      thickness: 15,
    };
    const thick: Wall = { ...thin, id: "thick", thickness: 30 };
    expect(deriveOuterLine(thin)[0].y).toBe(-15);
    expect(deriveOuterLine(thick)[0].y).toBe(-30);
  });
});

function layoutEdges(walls: Wall[]) {
  return tileProject(projectOf(walls)).layout.edges;
}
