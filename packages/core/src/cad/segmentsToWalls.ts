import type { Point, Wall } from "../types.js";

/** A straight run of drawing read out of a CAD file, in the file's own units. */
export interface CadSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  layer: string;
}

/** What one drawing unit is worth in centimetres. */
export const UNIT_SCALES = {
  mm: 0.1,
  cm: 1,
  m: 100,
} as const;

export type CadUnit = keyof typeof UNIT_SCALES;

export interface LayerSummary {
  name: string;
  segments: number;
  /** total drawn length, in centimetres at the given scale */
  totalLengthCm: number;
}

/** Per-layer counts, longest first — what the import dialog lists. */
export function summarizeLayers(segments: CadSegment[], unit: CadUnit): LayerSummary[] {
  const k = UNIT_SCALES[unit];
  const by = new Map<string, { n: number; len: number }>();
  for (const s of segments) {
    let e = by.get(s.layer);
    if (!e) by.set(s.layer, (e = { n: 0, len: 0 }));
    e.n++;
    e.len += Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * k;
  }
  return [...by.entries()]
    .map(([name, e]) => ({ name, segments: e.n, totalLengthCm: e.len }))
    .sort((a, b) => b.segments - a.segments);
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  widthCm: number;
  heightCm: number;
}

/** Extent of the chosen segments in centimetres — the dialog's sanity check. */
export function boundsOf(segments: CadSegment[], unit: CadUnit): Bounds | null {
  if (segments.length === 0) return null;
  const k = UNIT_SCALES[unit];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.x1 * k, s.x2 * k);
    maxX = Math.max(maxX, s.x1 * k, s.x2 * k);
    minY = Math.min(minY, s.y1 * k, s.y2 * k);
    maxY = Math.max(maxY, s.y1 * k, s.y2 * k);
  }
  return { minX, minY, maxX, maxY, widthCm: maxX - minX, heightCm: maxY - minY };
}

/**
 * Smallest and largest plausible diagonal for a real building plan, in cm.
 * A room is at least a couple of metres across; a site plan is not 5km.
 */
const PLAUSIBLE_MIN_CM = 200;
const PLAUSIBLE_MAX_CM = 50000;

/**
 * Picks the drawing's unit by seeing which one yields a building-sized result.
 *
 * The file's own `$INSUNITS` header is the obvious source and is honoured when
 * it gives a sane answer — but it frequently lies. In the customer's own plan
 * it claims millimetres while the geometry is plainly centimetres (a block
 * named "תבנית 75", a 75cm panel, measures 75.0 units). Scale is the one thing
 * the user cannot eyeball afterwards, so guessing well matters.
 */
export function pickUnit(segments: CadSegment[], headerUnit: CadUnit | undefined): CadUnit {
  const plausible = (unit: CadUnit): boolean => {
    const b = boundsOf(segments, unit);
    if (!b) return false;
    const diagonal = Math.hypot(b.widthCm, b.heightCm);
    return diagonal >= PLAUSIBLE_MIN_CM && diagonal <= PLAUSIBLE_MAX_CM;
  };

  if (headerUnit && plausible(headerUnit)) return headerUnit;
  for (const unit of ["cm", "mm", "m"] as const) {
    if (plausible(unit)) return unit;
  }
  return headerUnit ?? "cm";
}

export interface ToWallsOptions {
  /** layer name -> pour id; only these layers are imported */
  pourByLayer: Record<string, string>;
  unit: CadUnit;
  thicknessCm: number;
  /** Drop segments shorter than this, in cm. Hatching and noise, not walls. */
  minLengthCm?: number;
  /** Shift the result so its lower-left corner sits here. Keeps big drawings
   *  near the origin, where the canvas starts out looking. */
  originCm?: Point;
  makeId: (index: number) => string;
}

export interface ToWallsResult {
  walls: Wall[];
  /** how far the geometry was moved, so an export can put it back */
  offsetCm: Point;
  skippedShort: number;
}

const DEFAULT_MIN_LENGTH_CM = 20;

/**
 * Turns CAD segments into walls. Deliberately dumb: every segment on a chosen
 * layer becomes one wall of the given thickness. Measuring real thickness from
 * paired contours is `resolveWalls`' job once the walls are in the project.
 *
 * CAD drawings sit at arbitrary world coordinates — the customer's plan lives
 * around x=126000cm — so the result is translated to `originCm`, and the shift
 * is returned so the export can undo it and land back on their drawing.
 */
export function segmentsToWalls(
  segments: CadSegment[],
  options: ToWallsOptions
): ToWallsResult {
  const k = UNIT_SCALES[options.unit];
  const minLength = options.minLengthCm ?? DEFAULT_MIN_LENGTH_CM;

  const chosen = segments.filter((s) => options.pourByLayer[s.layer] !== undefined);

  let skippedShort = 0;
  const kept = chosen.filter((s) => {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * k;
    if (len < minLength) {
      skippedShort++;
      return false;
    }
    return true;
  });

  const bounds = boundsOf(kept, options.unit);
  const target = options.originCm ?? { x: 0, y: 0 };
  const offsetCm: Point = bounds
    ? { x: target.x - bounds.minX, y: target.y - bounds.minY }
    : { x: 0, y: 0 };

  const walls: Wall[] = kept.map((s, i) => ({
    id: options.makeId(i),
    pourId: options.pourByLayer[s.layer]!,
    innerLine: [
      { x: round1(s.x1 * k + offsetCm.x), y: round1(s.y1 * k + offsetCm.y) },
      { x: round1(s.x2 * k + offsetCm.x), y: round1(s.y2 * k + offsetCm.y) },
    ] as [Point, Point],
    thickness: options.thicknessCm,
  }));

  return { walls, offsetCm, skippedShort };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
