import { describe, expect, it } from "vitest";
import type { Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { resolveWalls } from "../../contours/resolveWalls.js";
import {
  doubleContourLShapeWalls,
  doubleContourRoomWalls,
} from "../../geometry/__tests__/fixtures.js";
import { placeCornerPanels } from "../placeCornerPanels.js";

function prep(walls: Wall[]) {
  return placeCornerPanels({
    resolution: resolveWalls(walls),
    walls,
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
  });
}

describe("face runs — re-entrant exterior corners", () => {
  it("reserves the selected corner-panel leg on a drawn non-room face", () => {
    const result = prep(doubleContourLShapeWalls());
    const exteriorLegs = result.cornerPanels.filter((panel) => !panel.faceIsInterior);

    expect(exteriorLegs).toHaveLength(2);
    for (const leg of exteriorLegs) {
      const end = leg.id.includes(":corner:A:") ? "A" : "B";
      const run = result.runs.get(leg.edgeId)?.[leg.side];
      expect(run?.[end === "A" ? "consumedAtA" : "consumedAtB"]).toBe(30);
    }
  });

  it("does not reserve a corner-panel leg where a non-room face folds outward", () => {
    const result = prep(doubleContourRoomWalls());

    expect(result.cornerPanels.filter((panel) => !panel.faceIsInterior)).toHaveLength(0);
    for (const wall of result.runs.values()) {
      const exteriorRun = wall.faceB;
      expect(exteriorRun.consumedAtA).toBe(0);
      expect(exteriorRun.consumedAtB).toBe(0);
    }
  });
});
