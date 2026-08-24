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

/** Rules fields a project saved before them would simply not have. */
const FIELDS_ADDED_LATER = ["timberGapMin", "timberGapMax", "strutSpacingCm"] as const;

/** A project saved at v2: correct placement shape, but predating later fields. */
function v2Project(): Project {
  const rules = { ...DEFAULT_ACCESSORY_RULES };
  for (const field of FIELDS_ADDED_LATER) delete (rules as Record<string, unknown>)[field];

  return {
    ...legacyProject(),
    schemaVersion: 2,
    rules: rules as Project["rules"],
    placements: [],
  };
}

describe("migrateProject — v2 to v3", () => {
  it("does not stop at v2 the way the old early return did", () => {
    // The previous shape returned any project already at the current version
    // untouched, so a v2 blob skipped every later step entirely.
    expect(migrateProject(v2Project()).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("fills in every AccessoryRules field the project predates", () => {
    // A missing rules field is not a cosmetic gap: it reaches the tiling
    // arithmetic as `undefined` and comes out the far end as a NaN clear length.
    const rules = migrateProject(v2Project()).rules;

    for (const key of FIELDS_ADDED_LATER) {
      expect(rules[key], key).toBe(DEFAULT_ACCESSORY_RULES[key]);
    }
    for (const value of Object.values(rules)) {
      expect(Number.isNaN(value as number)).toBe(false);
    }
  });

  it("keeps values the project already set rather than resetting them to defaults", () => {
    const customised = v2Project();
    customised.rules = { ...customised.rules, strutSpacingCm: 120 };

    expect(migrateProject(customised).rules.strutSpacingCm).toBe(120);
  });

  it("gives every pour a default wall thickness", () => {
    for (const pour of migrateProject(v2Project()).pours) {
      expect(pour.defaultThicknessCm).toBe(20);
    }
  });

  it("does not invent a pairing — only a compute may establish one", () => {
    for (const wall of migrateProject(v2Project()).walls) {
      expect(wall.pairedWallId).toBeUndefined();
    }
  });

  it("moves nothing on the canvas", () => {
    const before = v2Project();
    const after = migrateProject(before);

    expect(after.walls).toEqual(before.walls);
    expect(after.placements).toEqual(before.placements);
  });
});
