import { describe, expect, it } from "vitest";
import { buildDxf } from "../buildDxf.js";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG } from "../../defaults.js";
import type { Placement, Project, Wall } from "../../types.js";

function project(walls: Wall[], placements: Placement[] = []): Project {
  return {
    id: "p1",
    name: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [{ id: "pour1", name: "יציקה 1", color: "#dc2626", order: 0 }],
    walls,
    placements,
  };
}

const WALL: Wall = {
  id: "w1",
  pourId: "pour1",
  innerLine: [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
  ],
  thickness: 20,
};

/**
 * Reads a DXF back into (code, value) pairs. Empty values are legal — the STYLE
 * table's big-font name is normally blank — so only the trailing newline is
 * dropped, never interior blank lines, or every pair after one would shift.
 */
function tags(dxf: string): [string, string][] {
  const lines = dxf.split("\r\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i]!, lines[i + 1]!]);
  return out;
}

function entityTypes(dxf: string): string[] {
  return tags(dxf)
    .filter(([code]) => code === "0")
    .map(([, value]) => value);
}

describe("buildDxf", () => {
  it("produces a well-formed R12 document", () => {
    const dxf = buildDxf(project([WALL]));
    expect(dxf.startsWith("0\r\nSECTION")).toBe(true);
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);

    // Every tag must be a code/value pair — an odd count means a malformed file.
    const lines = dxf.split("\r\n");
    if (lines[lines.length - 1] === "") lines.pop();
    expect(lines.length % 2).toBe(0);

    const types = entityTypes(dxf);
    expect(types.filter((t) => t === "SECTION")).toHaveLength(3); // HEADER, TABLES, ENTITIES
    expect(types.filter((t) => t === "ENDSEC")).toHaveLength(3);
  });

  it("starts with the group code 0 and nothing before it", () => {
    // A byte-order mark or any leading whitespace here makes AutoCAD fail on
    // the first tag and open an empty drawing.
    const dxf = buildDxf(project([WALL]));
    expect(dxf.charCodeAt(0)).toBe(48); // "0"
  });

  it("declares the extents so AutoCAD opens looking at the geometry", () => {
    // Exported at the source drawing's real coordinates, a kilometre from the
    // origin. Without extents AutoCAD shows an empty screen.
    const dxf = buildDxf(project([WALL]), { offsetCm: { x: -126000, y: 47000 } });
    const pairs = tags(dxf);
    const valueAfter = (name: string, code: string) => {
      const i = pairs.findIndex(([c, v]) => c === "9" && v === name);
      const found = pairs.slice(i + 1).find(([c]) => c === code);
      return Number(found?.[1]);
    };
    expect(valueAfter("$EXTMIN", "10")).toBeCloseTo(126000);
    expect(valueAfter("$EXTMAX", "10")).toBeCloseTo(126300);
    expect(valueAfter("$VIEWCTR", "10")).toBeCloseTo(126150);
    expect(valueAfter("$VIEWSIZE", "40")).toBeGreaterThan(0);
  });

  it("defines an active viewport centred on the drawing", () => {
    const dxf = buildDxf(project([WALL]), { offsetCm: { x: -126000, y: 47000 } });
    expect(dxf).toContain("*ACTIVE");
    const pairs = tags(dxf);
    const i = pairs.findIndex(([c, v]) => c === "2" && v === "*ACTIVE");
    const centre = pairs.slice(i).find(([c]) => c === "12");
    expect(Number(centre?.[1])).toBeCloseTo(126150);
  });

  it("defines every table its entities reference", () => {
    const dxf = buildDxf(project([WALL]));
    // CONTINUOUS is named by every layer, STANDARD by every TEXT entity.
    // A dangling reference makes AutoCAD reject or silently drop content.
    expect(dxf).toContain("CONTINUOUS");
    expect(dxf).toContain("STANDARD");
    const types = entityTypes(dxf);
    expect(types).toContain("LTYPE");
    expect(types).toContain("STYLE");
    expect(types).toContain("VPORT");
    // LTYPE has to be declared before the LAYER entries that reference it.
    expect(dxf.indexOf("\r\nLTYPE\r\n")).toBeLessThan(dxf.indexOf("RASTO-WALLS"));
  });

  it("declares centimetres so AutoCAD does not rescale", () => {
    const pairs = tags(buildDxf(project([WALL])));
    const i = pairs.findIndex(([code, value]) => code === "9" && value === "$INSUNITS");
    expect(i).toBeGreaterThan(-1);
    expect(pairs[i + 1]).toEqual(["70", "5"]);
  });

  it("declares every layer it draws on", () => {
    const pairs = tags(buildDxf(project([WALL])));
    const declared = new Set(
      pairs
        .map((pair, i) => (pairs[i - 1]?.[1] === "LAYER" && pair[0] === "2" ? pair[1] : null))
        .filter((v): v is string => v !== null)
    );
    const used = new Set(
      pairs.filter(([code]) => code === "8").map(([, value]) => value)
    );
    for (const layer of used) expect(declared.has(layer)).toBe(true);
  });

  it("draws both faces of a wall", () => {
    const dxf = buildDxf(project([WALL]));
    expect(entityTypes(dxf).filter((t) => t === "LINE")).toHaveLength(2);
  });

  it("omits walls when asked for a formwork-only overlay", () => {
    const dxf = buildDxf(project([WALL]), { includeWalls: false });
    expect(entityTypes(dxf).filter((t) => t === "LINE")).toHaveLength(0);
  });

  it("draws a placement as a closed rectangle with a label", () => {
    const placement: Placement = {
      id: "pl1",
      edgeId: "edge:w1",
      wallId: "w1",
      pourId: "pour1",
      side: "faceA",
      faceIsInterior: true,
      kind: "panel",
      panelType: "75",
      offsetAlongEdge: 0,
      width: 75,
      source: "auto",
      flags: [],
    };
    const dxf = buildDxf(project([WALL], [placement]), { includeWalls: false });
    const types = entityTypes(dxf);
    expect(types.filter((t) => t === "LINE")).toHaveLength(4);
    expect(types.filter((t) => t === "TEXT")).toHaveLength(1);
    expect(dxf).toContain("RASTO-PANELS");
    expect(dxf).toContain("\r\n75\r\n");
  });

  it("subtracts the import offset so the file lands on the source coordinates", () => {
    const shifted = buildDxf(project([WALL]), { offsetCm: { x: -126000, y: 47000 } });
    // Only the ENTITIES section — the header and VPORT tables also use code 10.
    const pairs = tags(shifted);
    const start = pairs.findIndex(([code, value]) => code === "2" && value === "ENTITIES");
    const xs = pairs
      .slice(start)
      .filter(([code]) => code === "10")
      .map(([, value]) => Number(value));
    // The wall starts at x=0 in the model, and was imported from x=126000.
    expect(Math.min(...xs)).toBeCloseTo(126000);
  });

  it("emits an empty but valid document for an empty project", () => {
    const dxf = buildDxf(project([]));
    expect(entityTypes(dxf).filter((t) => t === "LINE")).toHaveLength(0);
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
  });
});
