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
  it("produces exactly the same panels as the same room drawn as one contour", () => {
    const twoContours = countPanels(tile(doubleContourRoomWalls()));
    const oneContour = countPanels(tile(rectangleWalls()));

    expect(twoContours.byType).toEqual(oneContour.byType);
    expect(twoContours.timberPieces).toBe(oneContour.timberPieces);
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

  it("counts every accessory the same as the one-contour room, struts included", () => {
    const two = projectOf(doubleContourRoomWalls());
    const one = projectOf(rectangleWalls());
    const twoResult = tileProject(two);
    const oneResult = tileProject(one);

    const count = (r: typeof twoResult, p: Project) =>
      countAccessories(r.placements, r.layout.edges, p.walls, DEFAULT_ACCESSORY_RULES);

    // Struts are counted per edge, so a consumed outer-contour wall left in the
    // layout would silently inflate them even though the panels came out right.
    expect(count(twoResult, two)).toEqual(count(oneResult, one));
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
    const placements = tile(doubleContourLShapeWalls());

    expect(countCornerUnits(placements)).toBe(6);
    expect(new Set(placements.map((p) => p.wallId)).size).toBe(6);
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
  it("tiles both faces as interior and puts no overlap strip on it", () => {
    const { placements } = tileProject(projectOf(roomWithInteriorWallWalls()));
    const partition = placements.filter((p) => p.wallId === "partition");

    expect(partition.length).toBeGreaterThan(0);
    expect(partition.every((p) => p.faceIsInterior)).toBe(true);
    expect(partition.some((p) => p.side === "faceA")).toBe(true);
    expect(partition.some((p) => p.side === "faceB")).toBe(true);
    expect(partition.some((p) => p.flags.includes("outer-corner-protrusion"))).toBe(false);
  });

  it("still reports four corner units at the box corners", () => {
    expect(countCornerUnits(tile(roomWithInteriorWallWalls()))).toBe(4);
  });
});

describe("tileProject — each face covers its own run", () => {
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

  it("tiles the outer ring over its full length, not just the inner ring's length", () => {
    const placements = tile(rectangleWalls());

    for (const wallId of ["bottom", "right", "top", "left"]) {
      const inner = assertContiguous(placements, `edge:${wallId}`, "faceA");
      const outer = assertContiguous(placements, `edge:${wallId}`, "faceB");

      const span = (run: Placement[]) =>
        run[run.length - 1]!.offsetAlongEdge + run[run.length - 1]!.width - run[0]!.offsetAlongEdge;

      // Inner: L - 30 - 30, the two corner-panel legs.
      // Outer: L + 20 + 20 wrapping to each outer corner, then the joint at
      // both ends — a panel thickness on the flatter walls, that less the
      // clearance on the steeper ones. 60 + 40 + 2x10 or 2x8.
      expect(span(outer)).toBe(span(inner) + 100);
      expect(outer[0]!.offsetAlongEdge).toBe(-20);
    }
  });

  it("covers the outer ring on the two-contour drawing as well", () => {
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
      assertContiguous(placements, `edge:${wallId}`, "faceB");
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

  it("stores the outer runs at the face intersection for visual lapping", () => {
    const { layout } = tileProject(projectOf(rectangleWalls()));
    const placements = tile(rectangleWalls());
    const outerOf = (wallId: string) =>
      placements
        .filter((p) => p.edgeId === `edge:${wallId}` && p.side === "faceB")
        .sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);

    // `bottom` is the flatter wall, so it carries a full panel thickness past
    // right's outer face (400+20+10) and covers the corner square outright.
    // `right` rides up over it, stopping the clearance short (-20-10+2).
    const bottom = outerOf("bottom");
    const last = bottom[bottom.length - 1]!;
    expect(last.offsetAlongEdge + last.width).toBe(420);
    expect(outerOf("right")[0]!.offsetAlongEdge).toBe(-20);
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

  it("returns both faces, each with panels", () => {
    const placements = tile(rectangleWalls());
    expect(placements.some((p) => p.side === "faceA")).toBe(true);
    expect(placements.some((p) => p.side === "faceB")).toBe(true);
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
