import type { CadSegment, CadUnit } from "./segmentsToWalls.js";
import { UNIT_SCALES, boundsOf } from "./segmentsToWalls.js";

/**
 * Splits a drawing into the separate structures it contains, so each becomes
 * its own pour.
 *
 * Layer names cannot do this job: in a real drawing both pours are usually on
 * the same layer (in Drawing1.dwg everything is on layer "0"). What actually
 * separates them is space — a pour is a group of outlines that touch or nest,
 * and the next pour is somewhere else on the sheet.
 */

/** Never merge things further apart than this, however big the drawing. */
const MIN_GAP_CM = 50;
/** Two structures closer than this fraction of the drawing's diagonal are one. */
const GAP_FRACTION_OF_DIAGONAL = 0.03;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxOf(s: CadSegment, k: number): Box {
  return {
    minX: Math.min(s.x1, s.x2) * k,
    maxX: Math.max(s.x1, s.x2) * k,
    minY: Math.min(s.y1, s.y2) * k,
    maxY: Math.max(s.y1, s.y2) * k,
  };
}

function merge(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Shortest distance between two boxes; 0 when they touch or overlap. */
function gap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

/**
 * Groups segments into spatially separate structures. Returns one array of
 * segments per group, largest first, so group 0 is the main structure.
 */
export function clusterPours(segments: CadSegment[], unit: CadUnit): CadSegment[][] {
  if (segments.length === 0) return [];
  const k = UNIT_SCALES[unit];

  const overall = boundsOf(segments, unit);
  const diagonal = overall ? Math.hypot(overall.widthCm, overall.heightCm) : 0;
  const threshold = Math.max(MIN_GAP_CM, diagonal * GAP_FRACTION_OF_DIAGONAL);

  // Grow clusters greedily: each segment joins the first cluster it is close
  // enough to, and clusters that later become close are merged. Fine at the
  // scale of a floor plan, and it keeps the rule easy to explain.
  let clusters: { box: Box; items: CadSegment[] }[] = [];

  for (const s of segments) {
    const box = boxOf(s, k);
    const hits: number[] = [];
    for (let i = 0; i < clusters.length; i++) {
      if (gap(clusters[i]!.box, box) <= threshold) hits.push(i);
    }

    if (hits.length === 0) {
      clusters.push({ box, items: [s] });
      continue;
    }

    const target = clusters[hits[0]!]!;
    target.box = merge(target.box, box);
    target.items.push(s);
    // This segment may bridge two clusters that were separate until now.
    for (let i = hits.length - 1; i >= 1; i--) {
      const absorbed = clusters[hits[i]!]!;
      target.box = merge(target.box, absorbed.box);
      target.items.push(...absorbed.items);
      clusters.splice(hits[i]!, 1);
    }
  }

  clusters = clusters.sort((a, b) => b.items.length - a.items.length);
  return clusters.map((c) => c.items);
}
