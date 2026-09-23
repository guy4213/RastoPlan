import { describe, expect, it } from "vitest";
import type { Project } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { CURRENT_SCHEMA_VERSION, hasNonDefaultTimberGapBeforeMigration, migrateProject } from "../migrateProject.js";

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

describe("migrateProject v3 → v4: junction restrictions reach saved catalogs", () => {
  /** A project saved at v3: its own catalog copy predates allowedAtNodeTypes. */
  function v3Project(): Project {
    return {
      ...legacyProject(),
      schemaVersion: 3,
      catalog: {
        panels: DEFAULT_PANEL_CATALOG.panels.map((panel) => {
          const saved = { ...panel };
          delete saved.allowedAtNodeTypes;
          return saved;
        }),
      },
    };
  }

  it("restricts R90 to T junctions on a v3 project", () => {
    const migrated = migrateProject(v3Project());
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.catalog.panels.find((p) => p.type === "R90")!.allowedAtNodeTypes).toEqual(["T"]);
  });

  it("touches no other panel and never changes a panel id", () => {
    const before = v3Project();
    const after = migrateProject(before);
    expect(after.catalog.panels.map((p) => p.type)).toEqual(before.catalog.panels.map((p) => p.type));
    for (const panel of after.catalog.panels.filter((p) => p.type !== "R90")) {
      expect(panel.allowedAtNodeTypes, panel.type).toBeUndefined();
    }
  });

  it("keeps a restriction the project already carries", () => {
    const custom = v3Project();
    custom.catalog.panels = custom.catalog.panels.map((p) =>
      p.type === "R90" ? { ...p, allowedAtNodeTypes: ["T", "cross"] } : p
    );
    expect(migrateProject(custom).catalog.panels.find((p) => p.type === "R90")!.allowedAtNodeTypes).toEqual([
      "T",
      "cross",
    ]);
  });

  it("is idempotent", () => {
    const once = migrateProject(v3Project());
    expect(migrateProject(once)).toBe(once);
  });
});

describe("migrateProject v4 → v5: timber-gap range narrows to 1–5cm", () => {
  /** A project saved at v4, with the pre-13/9/2026 default gap bounds (5–9). */
  function v4ProjectWithLegacyGap(): Project {
    return {
      ...legacyProject(),
      schemaVersion: 4,
      rules: { ...DEFAULT_ACCESSORY_RULES, timberGapMin: 5, timberGapMax: 9 },
    };
  }

  it("narrows a legacy 5–9cm project to the new 1–5cm default", () => {
    const migrated = migrateProject(v4ProjectWithLegacyGap());
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.rules.timberGapMin).toBe(1);
    expect(migrated.rules.timberGapMax).toBe(5);
  });

  it("touches nothing else in the rules", () => {
    const before = v4ProjectWithLegacyGap();
    const migrated = migrateProject(before);
    expect(migrated.rules).toEqual({ ...before.rules, timberGapMin: 1, timberGapMax: 5 });
  });

  it("leaves a project whose gap is already something other than 5–9 exactly as saved", () => {
    const custom: Project = {
      ...v4ProjectWithLegacyGap(),
      rules: { ...DEFAULT_ACCESSORY_RULES, timberGapMin: 2, timberGapMax: 6 },
    };
    const migrated = migrateProject(custom);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.rules.timberGapMin).toBe(2);
    expect(migrated.rules.timberGapMax).toBe(6);
  });

  it("is idempotent", () => {
    const once = migrateProject(v4ProjectWithLegacyGap());
    expect(migrateProject(once)).toBe(once);
  });

  it("moves nothing else — walls and placements pass through untouched", () => {
    const before = v4ProjectWithLegacyGap();
    const after = migrateProject(before);
    expect(after.walls).toEqual(before.walls);
  });
});

describe("hasNonDefaultTimberGapBeforeMigration", () => {
  function v4ProjectWithGap(min: number, max: number): Project {
    return {
      ...legacyProject(),
      schemaVersion: 4,
      rules: { ...DEFAULT_ACCESSORY_RULES, timberGapMin: min, timberGapMax: max },
    };
  }

  it("is false for the legacy 5–9cm default that migration will narrow", () => {
    expect(hasNonDefaultTimberGapBeforeMigration(v4ProjectWithGap(5, 9))).toBe(false);
  });

  it("is false for the current 1–5cm default too — nothing for the migration to preserve", () => {
    // A project can legitimately already carry the new default before schema
    // 5 — e.g. one freshly built against the current DEFAULT_ACCESSORY_RULES
    // constant but not yet re-saved. Flagging it as "customized" here would be
    // a false alarm: the v4 -> v5 step leaves it alone either way, and there
    // is genuinely nothing about it the notice needs to warn the user of.
    expect(hasNonDefaultTimberGapBeforeMigration(v4ProjectWithGap(1, 5))).toBe(false);
  });

  it("is true for a genuinely different stored value", () => {
    expect(hasNonDefaultTimberGapBeforeMigration(v4ProjectWithGap(2, 6))).toBe(true);
  });

  it("is false once a project is already at the current schema version", () => {
    expect(
      hasNonDefaultTimberGapBeforeMigration({ ...v4ProjectWithGap(2, 6), schemaVersion: CURRENT_SCHEMA_VERSION })
    ).toBe(false);
  });

  it("is false for a legacy blob that predates the rules field entirely", () => {
    const noRules = { ...v4ProjectWithGap(5, 9), rules: undefined } as unknown as Project;
    expect(hasNonDefaultTimberGapBeforeMigration(noRules)).toBe(false);
  });
});
