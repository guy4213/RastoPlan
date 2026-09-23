import type { Placement } from "@rastoplan/core";

export interface PlacementLabelOptions {
  /**
   * Display-only: drop a leading "R" from a plain straight-panel id (R75 ->
   * "75"). Corner ids (C30x30, A15x15) and the "חסר {type}" / "עץ {width}"
   * strings are never affected — the customer approved shortening only the
   * everyday straight-panel label, not the shortage/timber diagnostics.
   * Default true.
   */
  stripLeadingR?: boolean;
}

const LEADING_R_STRAIGHT_ID = /^R\d/;

/**
 * The text drawn on one placement, on the canvas and in the print export
 * alike — both must show the same label for the same placement, so this is
 * the single place that decides it.
 *
 * Mirrors the label logic that used to live inline in Placements.tsx:
 * inventory shortage and timber fillers get their own diagnostic text, an
 * outer-corner protrusion is labelled by its extra width, and everything
 * else falls back to the catalog `panelType` (or the placement's width when
 * that's empty). `placement.panelType` itself is never modified — only what
 * is drawn can differ, per the "R" display shortening above.
 */
export function placementLabel(placement: Placement, opts: PlacementLabelOptions = {}): string {
  if (placement.flags.includes("inventory-shortage")) {
    return `חסר ${placement.panelType}`;
  }
  // A whole run the catalog could not fill at all — distinct from an ordinary
  // legal timber filler ("עץ {width}"), which is a normal, expected result.
  if (placement.flags.includes("gap-out-of-range")) {
    return `אין פתרון ${Math.round(placement.width)}`;
  }
  if (placement.kind === "timber") {
    return `עץ ${Math.round(placement.width)}`;
  }
  if (placement.flags.includes("outer-corner-protrusion")) {
    return `+${Math.round(placement.width)}`;
  }

  const raw = placement.panelType || `${Math.round(placement.width)}`;
  const stripLeadingR = opts.stripLeadingR ?? true;
  if (stripLeadingR && placement.kind !== "corner-panel" && LEADING_R_STRAIGHT_ID.test(raw)) {
    return raw.slice(1);
  }
  return raw;
}
