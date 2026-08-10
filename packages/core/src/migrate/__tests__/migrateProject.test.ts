import { describe, expect, it } from "vitest";
import type { Project } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { CURRENT_SCHEMA_VERSION, migrateProject } from "../migrateProject.js";

/** A project blob saved before the contour layer: 'inner'/'outer', no wallId. */
function legacyProject(): Project {
  return {
    id: "proj-legacy",
    name: "ישן",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [{ id: "pour-1", name: "יציקה 1", color: "#000", order: 0 }],
    walls: [
      { id: "bottom", pourId: "pour-1", innerLine: [{ x: 0, y: 0 }, { x: 400, y: 0 }], thickness: 20 },
    ],
    placements: [
      {
        id: "placement:edge:bottom:0",
        edgeId: "edge:bottom",
        pourId: "pour-1",
        kind: "panel",
        panelType: "R75",
        offsetAlongEdge: 0,
        width: 75,
        source: "auto",
        flags: [],
      },
      {
        id: "placement:edge:bottom:0:outer:0",
        edgeId: "edge:bottom",
        pourId: "pour-1",
        kind: "panel",
        panelType: "R75",
        offsetAlongEdge: 0,
        width: 75,
        source: "auto",
        flags: [],
      },
    ].map((p, i) => ({ ...p, side: i === 0 ? "inner" : "outer" })) as unknown as Project["placements"],
  };
}

describe("migrateProject", () => {
  it("maps inner/outer onto faceA/faceB and records whether the face borders a room", () => {
    const migrated = migrateProject(legacyProject());

    expect(migrated.placements[0]!.side).toBe("faceA");
    expect(migrated.placements[0]!.faceIsInterior).toBe(true);
    expect(migrated.placements[1]!.side).toBe("faceB");
    expect(migrated.placements[1]!.faceIsInterior).toBe(false);
  });

  it("back-fills wallId from the edge id, where every call site used to dig it out", () => {
    for (const placement of migrateProject(legacyProject()).placements) {
      expect(placement.wallId).toBe("bottom");
    }
  });

  it("stamps the schema version and drops any stale layout", () => {
    const migrated = migrateProject(legacyProject());

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.layout).toBeUndefined();
  });

  it("is idempotent", () => {
    const once = migrateProject(legacyProject());
    expect(migrateProject(once)).toBe(once);
  });

  it("leaves the walls exactly as drawn", () => {
    expect(migrateProject(legacyProject()).walls).toEqual(legacyProject().walls);
  });
});
