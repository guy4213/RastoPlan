import type { Placement } from "../types.js";

/** A half-open stretch of a wall's along-axis frame, in centimetres. */
export interface Span {
  lo: number;
  hi: number;
}

/**
 * Whether a hand-edited placement is kept through a recompute and tiled around.
 *
 * Only straight-run items qualify. A corner panel belongs to the corners layer:
 * its leg width decides where every neighbouring run starts, so keeping a
 * hand-swapped corner while the runs are derived from the automatic one would
 * leave the two out of step. Corner overlap strips are drawing artefacts of the
 * corner joint, not physical units anyone places by hand.
 */
export function isPreservedManualPlacement(placement: Placement): boolean {
  return (
    placement.source === "manual" &&
    (placement.kind === "panel" || placement.kind === "timber") &&
    !placement.flags.includes("outer-corner-protrusion")
  );
}

/**
 * The stretches of one wall that hand-placed items occupy, merged and sorted.
 *
 * Deliberately NOT split by face: a Dywidag rod passes through both faces at
 * the same offset, so a manual panel on one face reserves that stretch on the
 * other face too. Filling the far face independently would put its joints out
 * of line with the hand-placed panel.
 */
export function blockedSpansFor(manualPlacements: readonly Placement[]): Span[] {
  const spans = manualPlacements
    .map((p) => ({
      lo: p.offsetAlongEdge,
      hi: p.offsetAlongEdge + p.width,
    }))
    .filter((s) => s.hi > s.lo)
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);

  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.lo <= last.hi) last.hi = Math.max(last.hi, span.hi);
    else merged.push({ ...span });
  }
  return merged;
}

/** What is left of `span` once every blocked stretch is removed, in along-axis order. */
export function subtractSpans(span: Span, blocked: readonly Span[]): Span[] {
  let pieces: Span[] = span.hi > span.lo ? [{ ...span }] : [];
  for (const cut of blocked) {
    pieces = pieces.flatMap((piece) => {
      if (cut.hi <= piece.lo || cut.lo >= piece.hi) return [piece];
      const out: Span[] = [];
      if (cut.lo > piece.lo) out.push({ lo: piece.lo, hi: cut.lo });
      if (cut.hi < piece.hi) out.push({ lo: cut.hi, hi: piece.hi });
      return out;
    });
  }
  return pieces;
}
