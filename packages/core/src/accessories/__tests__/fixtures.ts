import type { Pour, Project, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";

export const singlePour: Pour = { id: "pour-1", name: "יציקה 1", color: "#000", order: 0 };

export function projectOf(walls: Wall[], pours: Pour[] = [singlePour]): Project {
  return {
    id: "proj-accessories",
    name: "accessories test",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours,
    walls,
    placements: [],
  };
}

/**
 * A tiny two-pour room: pour-A owns walls a1/a2, pour-B owns walls b1/b2.
 * The four walls meet in a small closed box so classifyCornerSides can
 * resolve every corner, and the joint at (0,0)/(200,0) is shared between
 * pours — exercising the corner-clamp attribution rule.
 */
export function twoPourWalls(): { walls: Wall[]; pours: Pour[] } {
  return {
    walls: [
      { id: "a1", pourId: "pour-A", innerLine: [{ x: 0, y: 0 }, { x: 200, y: 0 }], thickness: 20 },
      { id: "a2", pourId: "pour-A", innerLine: [{ x: 200, y: 0 }, { x: 200, y: 200 }], thickness: 20 },
      { id: "b1", pourId: "pour-B", innerLine: [{ x: 200, y: 200 }, { x: 0, y: 200 }], thickness: 20 },
      { id: "b2", pourId: "pour-B", innerLine: [{ x: 0, y: 200 }, { x: 0, y: 0 }], thickness: 20 },
    ],
    pours: [
      { id: "pour-A", name: "יציקה A", color: "#f00", order: 0 },
      { id: "pour-B", name: "יציקה B", color: "#00f", order: 1 },
    ],
  };
}
