/**
 * Print-only SVG text helpers.
 *
 * Both bugs these fix were only found by actually printing the document in
 * headless Chrome — neither shows up just from reading the JSX or from
 * renderToStaticMarkup string assertions that don't reason about geometry.
 */

// ── RTL text-anchor ──────────────────────────────────────────────────────

/**
 * Where, visually on the page, a text node should sit relative to its `x`.
 * Independent of the string's own reading direction — this is the whole
 * point of the type.
 */
export type VisualTextAlign = "left" | "center" | "right";

/**
 * SVG `text-anchor` is defined relative to the text's OWN inline-progression
 * direction (`direction`), not the page: "start" is the beginning of the
 * string in reading order and "end" is the end of it. For LTR text that
 * happens to match "left" and "right" — for RTL text (`direction="rtl"`) it
 * is the exact opposite, because RTL reading order starts on the right.
 *
 * Getting this backwards is what clipped the title block off the sheet:
 * `text-anchor="end"` with `direction="rtl"` anchors the string's LEFT edge
 * at `x` and lets it run rightward, off the page, instead of hugging the
 * right margin. `rtlTextAnchor("right")` returns the anchor that actually
 * keeps RTL text's visual right edge at `x`.
 */
export function rtlTextAnchor(align: VisualTextAlign): "start" | "middle" | "end" {
  switch (align) {
    case "left":
      return "end";
    case "right":
      return "start";
    case "center":
      return "middle";
  }
}

// ── Upright rotation ─────────────────────────────────────────────────────

/**
 * Folds any rotation angle (degrees, clockwise, any range — as produced by
 * `Math.atan2` in a y-down world or already partially normalised) into
 * (-90, 90]: the range in which a horizontal string of text never reads
 * upside down.
 *
 * A wall (or a dimension line, which runs along one) is a line, not an
 * arrow — the panel/dimension label reads exactly the same whether we treat
 * the wall as running A→B or B→A. On a wall drawn back-to-front (right-to-
 * left or bottom-to-top, which nothing stops a user from doing), the raw
 * direction angle lands past ±90° and printing it as-is draws the label
 * upside down — unreadable on a physical sheet, unlike on screen where
 * nobody prints and holds up a Konva canvas.
 *
 * Folding by exactly ±180° keeps the label on the SAME line through the
 * SAME anchor point — a 180° turn about a text's own centre leaves its
 * bounding box in place, only right-side-up instead of upside-down — so
 * callers apply this to the angle only, never to the point it rotates
 * around.
 */
export function uprightRotationDeg(angleDeg: number): number {
  const wrapped = ((angleDeg % 360) + 360) % 360;
  const normalised = wrapped > 180 ? wrapped - 360 : wrapped;
  if (normalised > 90) return normalised - 180;
  if (normalised <= -90) return normalised + 180;
  return normalised;
}
