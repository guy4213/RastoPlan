import { describe, expect, it } from "vitest";
import type { AccessoryRules, Pour, Project, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { countPanels } from "../../accessories/countPanels.js";
import {
  doubleContourRoomWallsAt,
  lShapeWalls,
  rectangleWalls,
  rectangleWallsAt,
} from "../../geometry/__tests__/fixtures.js";
import { resolveWalls } from "../../contours/resolveWalls.js";
import { placeCornerPanels } from "../placeCornerPanels.js";
import { tileProjectPlacements } from "../tileProject.js";

const pour: Pour = { id: "pour-1", name: "יציקה 1", color: "#000", order: 0 };

function projectOf(walls: Wall[], rules: AccessoryRules = DEFAULT_ACCESSORY_RULES): Project {
  return {
    id: "proj-1",
    name: "test",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules,
    pours: [pour],
    walls,
    placements: [],
  };
}

function runsOf(walls: Wall[], rules: AccessoryRules = DEFAULT_ACCESSORY_RULES) {
  const resolution = resolveWalls(walls);
  return placeCornerPanels({
    resolution,
    walls,
    catalog: DEFAULT_PANEL_CATALOG,
    rules,
  }).runs;
}

describe("outer corner lap — steeper wall rides over flatter", () => {
  const PANEL = DEFAULT_ACCESSORY_RULES.outerCornerProtrusionCm;
  const CLEARANCE = DEFAULT_ACCESSORY_RULES.outerCornerLapGapCm;

  it("carries the flatter wall across and rides the steeper one over it", () => {
    const runs = runsOf(rectangleWalls());

    // bottom and top run left-right, so they carry the full panel thickness.
    for (const id of ["bottom", "top"]) {
      const run = runs.get(`edge:${id}`)!.faceB;
      expect(run.lapAtA, id).toBe(PANEL);
      expect(run.lapAtB, id).toBe(PANEL);
    }
    // right and left run up-down, so they stop the clearance short.
    for (const id of ["right", "left"]) {
      const run = runs.get(`edge:${id}`)!.faceB;
      expect(run.lapAtA, id).toBe(PANEL - CLEARANCE);
      expect(run.lapAtB, id).toBe(PANEL - CLEARANCE);
    }
  });

  it("treats all four corners of a room the same way up", () => {
    // A rotation around the contour would alternate them, and two of the four
    // would come out mirrored from the way the corner is actually built.
    const runs = runsOf(rectangleWalls());

    for (const id of ["bottom", "right", "top", "left"]) {
      const run = runs.get(`edge:${id}`)!.faceB;
      expect(run.lapAtA, id).toBe(run.lapAtB);
    }
  });

  it("keeps tileable lengths at the concrete extent and exposes the visual lap", () => {
    // Stored runs end at the outer-face lines. The canvas extends the already
    // selected end panels; billing must not see visual lap centimetres.
    const runs = runsOf(rectangleWalls());

    expect(
      runs.get("edge:bottom")!.faceB.startOffset + runs.get("edge:bottom")!.faceB.clearLength
    ).toBe(420);
    expect(runs.get("edge:right")!.faceB.startOffset).toBe(-20);
    expect(runs.get("edge:bottom")!.faceB.lapAtB).toBe(10);
    expect(runs.get("edge:right")!.faceB.lapAtA).toBe(8);
  });

  it("leaves the room-facing run completely alone", () => {
    // Corner panels, struts and dywidag all read the interior run. If the lap
    // touched it, every one of those counts would move with it.
    for (const walls of [rectangleWalls(), lShapeWalls(), doubleContourRoomWallsAt(20)]) {
      for (const [edgeId, run] of runsOf(walls)) {
        expect(run.faceA.lapAtA, edgeId).toBe(0);
        expect(run.faceA.lapAtB, edgeId).toBe(0);
      }
    }
  });

  it("does not touch a concave corner", () => {
    // The notch of the L-shape at (200,150). Only convex corners are joints;
    // at a concave one the outer face is already the short side.
    const runs = runsOf(lShapeWalls());

    expect(runs.get("edge:w3")!.faceB.lapAtB).toBe(0);
    expect(runs.get("edge:w4")!.faceB.lapAtA).toBe(0);
  });

  it("reproduces the old butt joint exactly when both rules are zero", () => {
    // Configurability, and a regression anchor for the pre-lap numbers.
    const rules: AccessoryRules = {
      ...DEFAULT_ACCESSORY_RULES,
      outerCornerProtrusionCm: 0,
      outerCornerLapGapCm: 0,
    };
    const run = runsOf(rectangleWalls(), rules).get("edge:bottom")!.faceB;

    expect(run.startOffset).toBe(-20);
    expect(run.clearLength).toBe(440);
  });

  it("scales with the rules rather than hard-coding 10 and 2", () => {
    const rules: AccessoryRules = {
      ...DEFAULT_ACCESSORY_RULES,
      outerCornerProtrusionCm: 14,
      outerCornerLapGapCm: 5,
    };
    const runs = runsOf(rectangleWalls(), rules);

    expect(runs.get("edge:bottom")!.faceB.lapAtA).toBe(14);
    expect(runs.get("edge:right")!.faceB.lapAtA).toBe(9);
  });
});

describe("outer corner lap — the drawing method must not change the bill", () => {
  it("bills a two-contour room exactly like the same room drawn as one line", () => {
    // The lap applies on top of a drawn far contour too. Skipping it there
    // would make the same building cost different amounts depending on how the
    // engineer traced it.
    for (const thickness of [10, 20]) {
      const two = countPanels(
        tileProjectPlacements(projectOf(doubleContourRoomWallsAt(thickness)))
      );
      const one = countPanels(tileProjectPlacements(projectOf(rectangleWallsAt(thickness))));

      expect(two.byType, `t=${thickness}`).toEqual(one.byType);
      expect(two.timberPieces, `t=${thickness}`).toBe(one.timberPieces);
    }
  });

  it("emits no duplicate placement at the lapped corners", () => {
    const placements = tileProjectPlacements(projectOf(rectangleWalls()));
    const footprints = placements.map((p) =>
      [p.edgeId, p.side, p.offsetAlongEdge.toFixed(2), p.width.toFixed(2)].join("|")
    );

    expect(new Set(footprints).size).toBe(footprints.length);
    // The old overlap markers stayed retired: the lap is real panel width, not
    // a separate block that every counter then has to remember to skip.
    expect(placements.filter((p) => p.flags.includes("outer-corner-protrusion"))).toHaveLength(0);
  });
});
