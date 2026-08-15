import type { OutwardSign, Placement, Point, Project, Wall } from "../types.js";

/**
 * Writes a DXF R12 ASCII document. DXF is a tagged text format, and R12 is the
 * flavour every CAD program still reads, so this needs no dependency at all —
 * which is why it can live in core.
 *
 * AutoCAD opens the result directly with File > Open. There is deliberately no
 * DWG writer: DWG is a closed binary format with no usable open implementation.
 */

const LAYERS: { name: string; color: number }[] = [
  { name: "RASTO-WALLS", color: 7 }, // white/black
  { name: "RASTO-PANELS", color: 3 }, // green
  { name: "RASTO-CORNERS", color: 1 }, // red
  { name: "RASTO-TIMBER", color: 2 }, // yellow
  { name: "RASTO-TEXT", color: 4 }, // cyan
];

/** How far a panel band is drawn out from the wall face, in cm. */
const BAND_DEPTH_CM = 12;
const LABEL_HEIGHT_CM = 8;

class Dxf {
  private out: string[] = [];
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  tag(code: number, value: string | number): void {
    this.out.push(String(code), String(value));
  }

  /**
   * Every emitted coordinate widens the extents. Without them AutoCAD opens a
   * drawing at its default view near the origin, and geometry exported at the
   * source drawing's real coordinates — over a kilometre out — is off screen.
   * That reads as "the file is empty".
   */
  private note(p: Point): void {
    this.minX = Math.min(this.minX, p.x);
    this.maxX = Math.max(this.maxX, p.x);
    this.minY = Math.min(this.minY, p.y);
    this.maxY = Math.max(this.maxY, p.y);
  }

  line(layer: string, a: Point, b: Point): void {
    this.note(a);
    this.note(b);
    this.tag(0, "LINE");
    this.tag(8, layer);
    this.tag(10, fmt(a.x));
    this.tag(20, fmt(a.y));
    this.tag(30, "0.0");
    this.tag(11, fmt(b.x));
    this.tag(21, fmt(b.y));
    this.tag(31, "0.0");
  }

  polygon(layer: string, pts: Point[]): void {
    for (let i = 0; i < pts.length; i++) {
      this.line(layer, pts[i]!, pts[(i + 1) % pts.length]!);
    }
  }

  text(layer: string, at: Point, height: number, value: string, rotationDeg: number): void {
    this.note(at);
    this.tag(0, "TEXT");
    this.tag(8, layer);
    this.tag(10, fmt(at.x));
    this.tag(20, fmt(at.y));
    this.tag(30, "0.0");
    this.tag(40, fmt(height));
    this.tag(1, value);
    this.tag(50, fmt(rotationDeg));
    // Named style, which the STYLE table below defines. Omitting it makes
    // AutoCAD fall back to a style that may not exist in a bare R12 file.
    this.tag(7, "STANDARD");
  }

  hasGeometry(): boolean {
    return Number.isFinite(this.minX);
  }

  body(): string[] {
    return this.out;
  }
}

function fmt(n: number): string {
  return (Math.round(n * 1e4) / 1e4).toFixed(4);
}

interface Frame {
  centerline: [Point, Point];
  thickness: number;
  faceBOffsetCm: number;
  outwardSign: OutwardSign;
}

/**
 * Mirrors the canvas's `resolvedWallFrame`: use the engine's resolution when
 * the project has been computed, otherwise fall back to the drawn line and the
 * typed thickness so an uncomputed project still exports something sensible.
 */
function frameOf(wall: Wall, project: Project): Frame {
  const resolved = project.layout?.resolvedWalls.find((w) => w.id === wall.id);
  if (resolved) {
    return {
      centerline: resolved.centerline,
      thickness: resolved.thickness,
      faceBOffsetCm: resolved.faceBOffsetCm,
      outwardSign: resolved.outwardSign,
    };
  }
  return {
    centerline: wall.innerLine,
    thickness: wall.thickness,
    faceBOffsetCm: wall.thickness,
    outwardSign: 1,
  };
}

function isConsumed(wallId: string, project: Project): boolean {
  return !!project.layout?.resolvedWalls.some((w) => w.consumedWallIds.includes(wallId));
}

function unit(a: Point, b: Point): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return { x: 1, y: 0 };
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

function layerFor(placement: Placement): string {
  if (placement.kind === "timber") return "RASTO-TIMBER";
  if (placement.kind === "corner-panel") return "RASTO-CORNERS";
  return "RASTO-PANELS";
}

function labelFor(placement: Placement): string {
  if (placement.kind === "timber") return `עץ ${Math.round(placement.width)}`;
  if (placement.flags.includes("outer-corner-protrusion")) return `+${Math.round(placement.width)}`;
  return placement.panelType || String(Math.round(placement.width));
}

export interface BuildDxfOptions {
  /**
   * Undoes the shift applied at import, so the file lands back on the
   * customer's original drawing coordinates. Pass the `offsetCm` that
   * `segmentsToWalls` returned.
   */
  offsetCm?: Point;
  /** Include the wall lines themselves. Off = an overlay of formwork only. */
  includeWalls?: boolean;
  /** Include panel/timber labels. */
  includeLabels?: boolean;
}

export function buildDxf(project: Project, options: BuildDxfOptions = {}): string {
  const shift = options.offsetCm ?? { x: 0, y: 0 };
  const includeWalls = options.includeWalls ?? true;
  const includeLabels = options.includeLabels ?? true;
  const move = (p: Point): Point => ({ x: p.x - shift.x, y: p.y - shift.y });

  const dxf = new Dxf();
  const wallById = new Map(project.walls.map((w) => [w.id, w]));

  if (includeWalls) {
    for (const wall of project.walls) {
      if (isConsumed(wall.id, project)) continue;
      const frame = frameOf(wall, project);
      const [a, b] = frame.centerline;
      const d = unit(a, b);
      const n = { x: d.y, y: -d.x };
      const off = frame.faceBOffsetCm * frame.outwardSign;

      dxf.line("RASTO-WALLS", move(a), move(b));
      dxf.line(
        "RASTO-WALLS",
        move({ x: a.x + n.x * off, y: a.y + n.y * off }),
        move({ x: b.x + n.x * off, y: b.y + n.y * off })
      );
    }
  }

  for (const placement of project.placements) {
    const wall = wallById.get(placement.wallId);
    if (!wall) continue;

    const frame = frameOf(wall, project);
    const [a, b] = frame.centerline;
    const d = unit(a, b);
    const n = { x: d.y, y: -d.x };

    // Face B sits one wall thickness out along the resolved outward direction;
    // face A sits on the centerline. Both bands then extend away from the wall
    // body so they never overlap it. Same rule the canvas draws by.
    const sideSign: 1 | -1 =
      placement.side === "faceB" ? frame.outwardSign : ((-frame.outwardSign) as 1 | -1);
    const baseOffset = placement.side === "faceB" ? frame.faceBOffsetCm * frame.outwardSign : 0;
    const push = { x: n.x * baseOffset, y: n.y * baseOffset };

    const start = {
      x: a.x + d.x * placement.offsetAlongEdge + push.x,
      y: a.y + d.y * placement.offsetAlongEdge + push.y,
    };
    const end = { x: start.x + d.x * placement.width, y: start.y + d.y * placement.width };
    const outward = { x: n.x * sideSign * BAND_DEPTH_CM, y: n.y * sideSign * BAND_DEPTH_CM };

    dxf.polygon(layerFor(placement), [
      move(start),
      move(end),
      move({ x: end.x + outward.x, y: end.y + outward.y }),
      move({ x: start.x + outward.x, y: start.y + outward.y }),
    ]);

    if (includeLabels && placement.width >= 20) {
      const mid = placement.offsetAlongEdge + placement.width / 2;
      dxf.text(
        "RASTO-TEXT",
        move({
          x: a.x + d.x * mid + (n.x * sideSign * BAND_DEPTH_CM) / 2 + push.x,
          y: a.y + d.y * mid + (n.y * sideSign * BAND_DEPTH_CM) / 2 + push.y,
        }),
        LABEL_HEIGHT_CM,
        labelFor(placement),
        (Math.atan2(d.y, d.x) * 180) / Math.PI
      );
    }
  }

  const head: string[] = [];
  const t = (code: number, value: string | number) => head.push(String(code), String(value));

  // Fall back to a small window around the origin when there is nothing to
  // draw, so the extents are still valid numbers.
  const minX = dxf.hasGeometry() ? dxf.minX : 0;
  const minY = dxf.hasGeometry() ? dxf.minY : 0;
  const maxX = dxf.hasGeometry() ? dxf.maxX : 100;
  const maxY = dxf.hasGeometry() ? dxf.maxY : 100;
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  // A little breathing room, and never zero height for a single straight wall.
  const viewHeight = Math.max((maxY - minY) * 1.2, (maxX - minX) * 1.2, 100);

  t(0, "SECTION");
  t(2, "HEADER");
  t(9, "$ACADVER");
  t(1, "AC1009");
  // 5 = centimetres. Everything in the model is cm, so say so and AutoCAD
  // will not rescale the drawing on insert.
  t(9, "$INSUNITS");
  t(70, 5);
  t(9, "$MEASUREMENT");
  t(70, 1);
  t(9, "$EXTMIN");
  t(10, fmt(minX));
  t(20, fmt(minY));
  t(30, "0.0");
  t(9, "$EXTMAX");
  t(10, fmt(maxX));
  t(20, fmt(maxY));
  t(30, "0.0");
  t(9, "$LIMMIN");
  t(10, fmt(minX));
  t(20, fmt(minY));
  t(9, "$LIMMAX");
  t(10, fmt(maxX));
  t(20, fmt(maxY));
  // Where the model-space view is centred when the file is opened.
  t(9, "$VIEWCTR");
  t(10, fmt(centreX));
  t(20, fmt(centreY));
  t(9, "$VIEWSIZE");
  t(40, fmt(viewHeight));
  t(0, "ENDSEC");

  t(0, "SECTION");
  t(2, "TABLES");

  // LTYPE must come before LAYER: every layer below names CONTINUOUS, and a
  // reader that meets the reference before the definition can reject the file.
  t(0, "TABLE");
  t(2, "LTYPE");
  t(70, 1);
  t(0, "LTYPE");
  t(2, "CONTINUOUS");
  t(70, 0);
  t(3, "Solid line");
  t(72, 65);
  t(73, 0);
  t(40, "0.0");
  t(0, "ENDTAB");

  t(0, "TABLE");
  t(2, "LAYER");
  t(70, LAYERS.length);
  for (const l of LAYERS) {
    t(0, "LAYER");
    t(2, l.name);
    t(70, 0);
    t(62, l.color);
    t(6, "CONTINUOUS");
  }
  t(0, "ENDTAB");

  // Every TEXT entity names STANDARD; without this table the style is dangling.
  t(0, "TABLE");
  t(2, "STYLE");
  t(70, 1);
  t(0, "STYLE");
  t(2, "STANDARD");
  t(70, 0);
  t(40, "0.0");
  t(41, "1.0");
  t(50, "0.0");
  t(71, 0);
  t(42, fmt(LABEL_HEIGHT_CM));
  t(3, "txt");
  t(4, "");
  t(0, "ENDTAB");

  // The active viewport is what actually decides where AutoCAD is looking when
  // the drawing opens. This is the difference between seeing the formwork and
  // seeing an empty black screen.
  t(0, "TABLE");
  t(2, "VPORT");
  t(70, 1);
  t(0, "VPORT");
  t(2, "*ACTIVE");
  t(70, 0);
  t(10, "0.0");
  t(20, "0.0");
  t(11, "1.0");
  t(21, "1.0");
  t(12, fmt(centreX));
  t(22, fmt(centreY));
  t(13, "0.0");
  t(23, "0.0");
  t(14, "10.0");
  t(24, "10.0");
  t(15, "10.0");
  t(25, "10.0");
  t(16, "0.0");
  t(26, "0.0");
  t(36, "1.0");
  t(17, "0.0");
  t(27, "0.0");
  t(37, "0.0");
  t(40, fmt(viewHeight));
  t(41, "1.8");
  t(42, "50.0");
  t(43, "0.0");
  t(44, "0.0");
  t(50, "0.0");
  t(51, "0.0");
  t(71, 0);
  t(72, 100);
  t(73, 1);
  t(74, 3);
  t(75, 0);
  t(76, 0);
  t(77, 0);
  t(78, 0);
  t(0, "ENDTAB");

  t(0, "ENDSEC");

  t(0, "SECTION");
  t(2, "ENTITIES");

  const tail = ["0", "ENDSEC", "0", "EOF"];
  return [...head, ...dxf.body(), ...tail].join("\r\n") + "\r\n";
}
