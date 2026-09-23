import { describe, expect, it } from "vitest";
import type { Placement, Pour, Wall } from "@rastoplan/core";
import { buildPrintDocument, type PrintPlanInput } from "./printPlan.js";

function wall(id: string, pourId: string, a: [number, number], b: [number, number]): Wall {
  return {
    id,
    pourId,
    innerLine: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }],
    thickness: 20,
    thicknessSet: true,
  };
}

function fixture(): PrintPlanInput {
  const walls: Wall[] = [wall("w1", "p1", [0, 0], [340, 0])];
  const pours: Pour[] = [{ id: "p1", name: "יציקה 2", color: "#2563eb", order: 0 }];
  const placements: Placement[] = [
    {
      id: "pl1",
      edgeId: "edge:w1",
      wallId: "w1",
      pourId: "p1",
      side: "faceA",
      faceIsInterior: true,
      kind: "panel",
      panelType: "R75",
      offsetAlongEdge: 0,
      width: 75,
      source: "auto",
      flags: [],
    },
  ];
  return {
    projectName: "פרויקט הדפסה",
    walls,
    pours,
    placements,
    layout: undefined,
    page: "A3",
    cornerProtrusionCm: 10,
    cornerLapGapCm: 2,
    generatedAt: "2026-01-15T00:00:00.000Z",
  };
}

describe("buildPrintDocument", () => {
  it("marks the whole document dir=\"rtl\" lang=\"he\" so the browser's own bidi engine lays out Hebrew/digits/Latin", () => {
    const html = buildPrintDocument(fixture());
    expect(html).toContain('<html dir="rtl" lang="he">');
  });

  it.each([
    ["A3", 420, 297],
    ["A1", 841, 594],
    ["A0", 1189, 841],
  ] as const)("sets the exact @page size for %s", (page, widthMm, heightMm) => {
    const html = buildPrintDocument({ ...fixture(), page });
    expect(html).toContain(`@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`);
  });

  it("embeds the rendered SVG plan with the Hebrew project title intact", () => {
    const html = buildPrintDocument(fixture());
    expect(html).toContain("<svg");
    expect(html).toContain("</svg>");
    expect(html).toContain("פרויקט הדפסה");
  });

  it("HTML-escapes the project name in <title> without corrupting it", () => {
    const html = buildPrintDocument({ ...fixture(), projectName: 'פרויקט <בדיקה> & "מיוחד"' });
    expect(html).toContain("<title>פרויקט &lt;בדיקה&gt; &amp; &quot;מיוחד&quot;</title>");
  });

  it("produces a single well-formed HTML document", () => {
    const html = buildPrintDocument(fixture());
    expect(html.trim().startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</html>");
  });
});
