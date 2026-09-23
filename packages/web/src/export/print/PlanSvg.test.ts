import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Placement, Pour, Wall } from "@rastoplan/core";
import { PlanSvg, type PlanSvgProps } from "./PlanSvg.js";

/**
 * renderToStaticMarkup HTML-escapes quote characters even inside text
 * content, which would otherwise make a byte-for-byte assertion on
 * formatLength's `340 ס"מ` fail for a reason that has nothing to do with
 * Hebrew bidi correctness (the thing this test actually exists to guard).
 * Decoding first lets the assertions read as the literal strings a human
 * would see on the printed page.
 */
function decodeEntities(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function wall(id: string, pourId: string, a: [number, number], b: [number, number], thickness = 20): Wall {
  return {
    id,
    pourId,
    innerLine: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }],
    thickness,
    thicknessSet: true,
  };
}

function pour(id: string, name: string, order: number, color = "#2563eb"): Pour {
  return { id, name, color, order };
}

function basePlacement(overrides: Partial<Placement>): Placement {
  return {
    id: overrides.id ?? "pl",
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
    ...overrides,
  };
}

// A single 340cm wall belonging to a pour named "יציקה 2", carrying one
// inventory-shortage placement ("חסר R40") and one timber filler ("עץ 7") —
// exactly the mixed Hebrew/digit/Latin content a real plan prints.
function fixture(): PlanSvgProps {
  const walls: Wall[] = [wall("w1", "p1", [0, 0], [340, 0])];
  const pours: Pour[] = [pour("p1", "יציקה 2", 0)];
  const placements: Placement[] = [
    basePlacement({ id: "pl-shortage", panelType: "R40", offsetAlongEdge: 0, width: 40, flags: ["inventory-shortage"] }),
    basePlacement({ id: "pl-timber", kind: "timber", panelType: "", offsetAlongEdge: 40, width: 7 }),
    basePlacement({ id: "pl-plain", panelType: "R75", offsetAlongEdge: 47, width: 75 }),
  ];
  return {
    projectName: "פרויקט בדיקה",
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

describe("PlanSvg (Hebrew/digit/Latin fidelity)", () => {
  it("renders a well-formed SVG with the exact pour name, shortage, timber, and dimension strings intact", () => {
    const markup = decodeEntities(renderToStaticMarkup(createElement(PlanSvg, fixture())));

    expect(markup.startsWith("<svg")).toBe(true);
    expect(markup).toContain("יציקה 2");
    expect(markup).toContain("חסר R40");
    expect(markup).toContain("עץ 7");
    // The plain R75 placement displays with the leading R stripped.
    expect(markup).toContain(">75<");
    // formatLength(340, "cm") -> `340 ס"מ` — digits and the Hebrew unit both intact.
    expect(markup).toContain('340 ס"מ');
  });

  it("sets an explicit RTL direction on the SVG root and on Hebrew text nodes", () => {
    const markup = renderToStaticMarkup(createElement(PlanSvg, fixture()));
    expect(markup).toMatch(/<svg[^>]*direction="rtl"/);
    // Every Hebrew label is drawn as a <text> carrying its own direction.
    expect(markup.match(/<text[^>]*direction="rtl"/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it("uses a Chrome/Windows-safe font stack for every text node", () => {
    const markup = renderToStaticMarkup(createElement(PlanSvg, fixture()));
    const textNodes = markup.match(/<text[^>]*>/g) ?? [];
    expect(textNodes.length).toBeGreaterThan(0);
    for (const node of textNodes) {
      expect(node).toContain("Segoe UI");
    }
  });

  it("sizes the sheet to the requested page (A3/A1/A0) in mm", () => {
    for (const [page, widthMm, heightMm] of [
      ["A3", 420, 297],
      ["A1", 841, 594],
      ["A0", 1189, 841],
    ] as const) {
      const markup = renderToStaticMarkup(createElement(PlanSvg, { ...fixture(), page }));
      expect(markup).toContain(`width="${widthMm}mm"`);
      expect(markup).toContain(`height="${heightMm}mm"`);
      expect(markup).toContain(`viewBox="0 0 ${widthMm} ${heightMm}"`);
    }
  });

  it("renders one label per disconnected group of a pour's walls", () => {
    const props = fixture();
    // A second, far-away wall for the same pour — a physically separate group.
    props.walls = [...props.walls, wall("w2", "p1", [10_000, 10_000], [10_100, 10_000])];
    const markup = renderToStaticMarkup(createElement(PlanSvg, props));
    const occurrences = markup.split("יציקה 2").length - 1;
    expect(occurrences).toBe(2);
  });

  it("does not throw and still renders the title block for an empty project", () => {
    const markup = renderToStaticMarkup(
      createElement(PlanSvg, { ...fixture(), walls: [], pours: [], placements: [] })
    );
    expect(markup).toContain("פרויקט בדיקה");
    expect(markup).toContain("<svg");
  });
});

/** Pulls out the first `<text ...>...</text>` element whose text content contains `needle`. */
function extractTextElement(markup: string, needle: string): string {
  const pattern = /<text\b[^>]*>[^<]*<\/text>/g;
  const match = [...markup.matchAll(pattern)].find((m) => m[0].includes(needle));
  if (!match) throw new Error(`no <text> element found containing ${JSON.stringify(needle)}`);
  return match[0];
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1]! : null;
}

describe("PlanSvg title block (RTL text-anchor)", () => {
  it('right-aligns the project name using text-anchor="start" for RTL text (not "end", which clips it off the sheet)', () => {
    const markup = renderToStaticMarkup(createElement(PlanSvg, fixture()));
    const titleNode = extractTextElement(markup, "פרויקט בדיקה");
    expect(attr(titleNode, "direction")).toBe("rtl");
    expect(attr(titleNode, "text-anchor")).toBe("start");
  });

  it('right-aligns the date/scale line using text-anchor="start" for RTL text', () => {
    const markup = renderToStaticMarkup(createElement(PlanSvg, fixture()));
    const scaleNode = extractTextElement(markup, "קנה מידה");
    expect(attr(scaleNode, "direction")).toBe("rtl");
    expect(attr(scaleNode, "text-anchor")).toBe("start");
  });

  it("every text node anchored at the right margin uses text-anchor=start (the general rule the clipping bug violated)", () => {
    const markup = renderToStaticMarkup(createElement(PlanSvg, fixture()));
    const textTags = markup.match(/<text\b[^>]*>/g) ?? [];
    // x="405" is pageWidthMm(420) - MARGIN_MM(15) for A3 — the right-margin x
    // every title-block node is anchored at.
    const rightMarginNodes = textTags.filter((tag) => attr(tag, "x") === "405");
    expect(rightMarginNodes.length).toBeGreaterThan(0);
    for (const tag of rightMarginNodes) {
      expect(attr(tag, "direction")).toBe("rtl");
      expect(attr(tag, "text-anchor")).toBe("start");
    }
  });
});

describe("PlanSvg rotation (never upside down on paper)", () => {
  function rotateAngle(tag: string): number {
    const transform = attr(tag, "transform") ?? "";
    const match = transform.match(/rotate\(([-\d.]+)/);
    if (!match) throw new Error(`no rotate() transform found in ${transform}`);
    return Number(match[1]);
  }

  it("keeps a panel label upright on a wall drawn right-to-left", () => {
    const props = fixture();
    // Same wall, opposite drag direction: endpoints swapped.
    props.walls = [wall("w1", "p1", [340, 0], [0, 0])];
    const markup = renderToStaticMarkup(createElement(PlanSvg, props));
    const textTags = markup.match(/<text\b[^>]*>[^<]*<\/text>/g) ?? [];
    const plainLabelTag = textTags.find((tag) => tag.includes(">75<"));
    expect(plainLabelTag).toBeDefined();
    const angle = rotateAngle(plainLabelTag!);
    expect(angle).toBeGreaterThan(-90);
    expect(angle).toBeLessThanOrEqual(90);
  });

  it("keeps a wall's length dimension upright on a wall drawn bottom-to-top (the exact -90° boundary case)", () => {
    const props = fixture();
    // A vertical wall drawn from bottom to top: dx=0, dy=-length -> raw
    // angle exactly -90°, the boundary wallLabelPlacement's own upside-down
    // guard does not flip (it only flips angleDeg < -90, strictly).
    props.walls = [wall("w1", "p1", [0, 340], [0, 0])];
    props.placements = [];
    const markup = renderToStaticMarkup(createElement(PlanSvg, props));
    const textTags = markup.match(/<text\b[^>]*>[^<]*<\/text>/g) ?? [];
    const dimensionTag = textTags.find((tag) => tag.includes('340 ס'));
    expect(dimensionTag).toBeDefined();
    const angle = rotateAngle(dimensionTag!);
    expect(angle).toBeGreaterThan(-90);
    expect(angle).toBeLessThanOrEqual(90);
    // Specifically: folded to +90, not left at the un-upright -90.
    expect(angle).toBeCloseTo(90, 6);
  });
});

describe("PlanSvg centering", () => {
  it("centers a small drawing within the printable area instead of pinning it to the top-left corner", () => {
    const props = fixture();
    // A short wall near the world origin, printed on the largest sheet (A0)
    // — plenty of slack, so a top-left placement and a centered one are
    // trivially distinguishable.
    props.walls = [wall("w1", "p1", [0, 0], [10, 0])];
    props.placements = [];
    props.page = "A0";
    const markup = renderToStaticMarkup(createElement(PlanSvg, props));
    // React renders SVG void elements as an open/close pair (<line ...></line>),
    // not self-closing, so the tag match must not require "/>".
    const lineTags = markup.match(/<line\b[^>]*>/g) ?? [];
    const wallLine = lineTags.find((tag) => attr(tag, "x1") !== null && attr(tag, "y1") !== null);
    expect(wallLine).toBeDefined();
    const x1 = Number(attr(wallLine!, "x1"));
    // Comfortably past the plain 15mm margin — proof the drawing was shifted
    // to the middle of the sheet, not left pinned at the top-left corner.
    expect(x1).toBeGreaterThan(100);
  });

  it("uses a smaller non-standard scale instead of clipping a plan that does not fit at 1:1000", () => {
    const props = fixture();
    props.walls = [wall("w1", "p1", [0, 0], [500_000, 0])];
    props.placements = [];
    const markup = renderToStaticMarkup(createElement(PlanSvg, props));
    const scaleMatch = markup.match(/קנה מידה 1:(\d+)/);
    expect(scaleMatch).not.toBeNull();
    expect(Number(scaleMatch![1])).toBeGreaterThan(1000);

    const wallLine = (markup.match(/<line\b[^>]*>/g) ?? []).find(
      (tag) => attr(tag, "x1") !== null && attr(tag, "x2") !== null
    );
    expect(wallLine).toBeDefined();
    for (const coordinate of ["x1", "x2", "y1", "y2"] as const) {
      const value = Number(attr(wallLine!, coordinate));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(coordinate.startsWith("x") ? 420 : 297);
    }
  });
});
