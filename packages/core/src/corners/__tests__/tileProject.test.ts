import { describe, expect, it } from "vitest";
import type { Placement, Pour, Project, Wall } from "../../types.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import { deriveOuterLine } from "../deriveOuterLine.js";
import { rectangleWalls, lShapeWalls } from "../../geometry/__tests__/fixtures.js";
import { tileProject } from "../tileProject.js";

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

function offsetsFor(placements: Placement[], edgeId: string, side: "inner" | "outer"): number[] {
  return placements
    .filter((p) => p.edgeId === edgeId && p.side === side)
    // The sync invariant covers the STRAIGHT run only. Both corner artifacts
    // are single-sided by design — the C30x30 exists on the inner face, the
    // overlap strip on the outer — so including either would falsely fail
    // the "every inner joint has an outer joint" check.
    .filter((p) => !p.flags.includes("outer-corner-protrusion"))
    .filter((p) => p.kind !== "corner-panel")
    .map((p) => p.offsetAlongEdge)
    .sort((a, b) => a - b);
}

describe("tileProject — Dywidag sync", () => {
  it("rectangular room: every inner joint has an outer joint at the exact same offsetAlongEdge", () => {
    const placements = tileProject(projectOf(rectangleWalls()));
    for (const wallId of ["bottom", "right", "top", "left"]) {
      const edgeId = `edge:${wallId}`;
      const inner = offsetsFor(placements, edgeId, "inner");
      const outer = offsetsFor(placements, edgeId, "outer");
      expect(inner.length).toBeGreaterThan(0);
      expect(outer).toEqual(inner);
    }
  });

  it("preserves offsetAlongEdge across sync even when widths vary (mixed panel types on the same wall)", () => {
    const placements = tileProject(projectOf(rectangleWalls()));
    // Pair-up inner and outer placements by (edgeId, offsetAlongEdge) — for
    // each such pair we expect matching widths and panel types, since sync
    // is a straight copy with side flipped.
    const byKey = new Map<string, { inner?: Placement; outer?: Placement }>();
    for (const p of placements) {
      if (p.flags.includes("outer-corner-protrusion")) continue;
      if (p.kind === "corner-panel") continue;
      const key = `${p.edgeId}:${p.offsetAlongEdge}`;
      const slot = byKey.get(key) ?? {};
      slot[p.side] = p;
      byKey.set(key, slot);
    }
    for (const [key, slot] of byKey) {
      expect(slot.inner, `missing inner for ${key}`).toBeDefined();
      expect(slot.outer, `missing outer for ${key}`).toBeDefined();
      expect(slot.outer?.width).toBe(slot.inner?.width);
      expect(slot.outer?.panelType).toBe(slot.inner?.panelType);
      expect(slot.outer?.kind).toBe(slot.inner?.kind);
    }
  });
});

describe("tileProject — 10cm rule at outer corners", () => {
  it("rectangular room: each outer corner gets a straight (not corner-panel) 10cm protrusion on the outer face", () => {
    const placements = tileProject(projectOf(rectangleWalls()));
    const protrusions = placements.filter((p) => p.flags.includes("outer-corner-protrusion"));

    // 4 outer corners × 2 meeting walls each = 8 protrusions.
    expect(protrusions).toHaveLength(8);
    for (const p of protrusions) {
      expect(p.side).toBe("outer");
      expect(p.width).toBe(DEFAULT_ACCESSORY_RULES.outerCornerProtrusionCm);
      expect(p.kind).not.toBe("corner-panel");
    }
    // The overlap is the OUTER half of the corner story; the inner half is a
    // corner panel, present at these same convex corners.
    const cornerLegs = placements.filter((p) => p.kind === "corner-panel");
    expect(cornerLegs).toHaveLength(8);
    expect(cornerLegs.every((p) => p.side === "inner")).toBe(true);
  });

  it("uses the configured outerCornerProtrusionCm, not a hard-coded 10", () => {
    const project = projectOf(rectangleWalls());
    const custom: Project = {
      ...project,
      rules: { ...project.rules, outerCornerProtrusionCm: 12 },
    };
    const placements = tileProject(custom);
    for (const p of placements.filter((x) => x.flags.includes("outer-corner-protrusion"))) {
      expect(p.width).toBe(12);
    }
  });
});

describe("tileProject — corner panels", () => {
  it("L-shape: every corner gets a C30x30, inner face only, one leg per meeting wall", () => {
    const placements = tileProject(projectOf(lShapeWalls()));
    const cornerPanels = placements.filter((p) => p.kind === "corner-panel");

    // 6 corners × 2 meeting walls = 12 legs, 6 physical panels.
    expect(cornerPanels).toHaveLength(12);
    expect(new Set(cornerPanels.map((p) => p.groupId)).size).toBe(6);
    expect(cornerPanels.every((p) => p.panelType === "C30x30")).toBe(true);
    expect(cornerPanels.every((p) => p.side === "inner")).toBe(true);

    // The notch walls each carry a leg at both of their ends.
    for (const wallId of ["w3", "w4"]) {
      expect(cornerPanels.filter((p) => p.edgeId === `edge:${wallId}`)).toHaveLength(2);
    }
  });
});

describe("tileProject — full pipeline coherence", () => {
  it("rectangular room: no unexpected failure flags on any placement", () => {
    const placements = tileProject(projectOf(rectangleWalls()));
    for (const p of placements) {
      // The only tolerated flag in this fully-resolved layout is the
      // deliberate outer-corner-protrusion marker.
      const unexpected = p.flags.filter((f) => f !== "outer-corner-protrusion");
      expect(unexpected, `edge=${p.edgeId} side=${p.side}`).toHaveLength(0);
    }
  });

  it("returns some inner + some outer + some protrusion placements (all three buckets non-empty)", () => {
    const placements = tileProject(projectOf(rectangleWalls()));
    expect(placements.some((p) => p.side === "inner")).toBe(true);
    expect(placements.some((p) => p.side === "outer" && !p.flags.includes("outer-corner-protrusion"))).toBe(true);
    expect(placements.some((p) => p.flags.includes("outer-corner-protrusion"))).toBe(true);
  });
});

describe("tileProject — variable wall thickness", () => {
  it("deriveOuterLine offsets each wall by its own thickness (not a global constant)", () => {
    // Same wall geometry, two thicknesses — the outer lines land at
    // different y coordinates, matching per-wall thickness.
    const thin: Wall = {
      id: "thin",
      pourId: "pour-1",
      innerLine: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      thickness: 15,
    };
    const thick: Wall = { ...thin, id: "thick", thickness: 30 };
    expect(deriveOuterLine(thin)[0].y).toBe(-15);
    expect(deriveOuterLine(thick)[0].y).toBe(-30);
  });

  it("full pipeline runs on a room mixing 20cm and 30cm walls: inner/outer sync still holds per wall", () => {
    const walls: Wall[] = [
      { id: "bottom", pourId: "pour-1", innerLine: [{ x: 0, y: 0 }, { x: 300, y: 0 }], thickness: 20 },
      { id: "right", pourId: "pour-1", innerLine: [{ x: 300, y: 0 }, { x: 300, y: 300 }], thickness: 30 },
      { id: "top", pourId: "pour-1", innerLine: [{ x: 300, y: 300 }, { x: 0, y: 300 }], thickness: 20 },
      { id: "left", pourId: "pour-1", innerLine: [{ x: 0, y: 300 }, { x: 0, y: 0 }], thickness: 30 },
    ];
    const placements = tileProject(projectOf(walls));

    // Sync still holds regardless of thickness — Dywidag alignment is per
    // wall and doesn't care about neighbor thickness.
    for (const wallId of ["bottom", "right", "top", "left"]) {
      const inner = offsetsFor(placements, `edge:${wallId}`, "inner");
      const outer = offsetsFor(placements, `edge:${wallId}`, "outer");
      expect(outer).toEqual(inner);
    }
    // And no unexpected flags surface.
    for (const p of placements) {
      const unexpected = p.flags.filter((f) => f !== "outer-corner-protrusion");
      expect(unexpected).toHaveLength(0);
    }
  });
});
