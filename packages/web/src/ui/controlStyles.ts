import type { CSSProperties } from "react";

/**
 * Shared control-sizing primitives for compact toolbars and inline controls.
 * Every toolbar button was drifting toward its own padding/font-size, which
 * is how "צייר קיר" ended up wrapping onto two lines at 100% browser zoom —
 * once one button's intrinsic width forced the flex row to shrink, mismatched
 * sizes meant no two buttons shrank (or refused to shrink) the same way.
 * Pulling the sizes here keeps every consumer visually and dimensionally in
 * sync, the same way `authStyles` keeps the login/registration screens from
 * drifting apart.
 *
 * `whiteSpace: "nowrap"` and `flexShrink: 0` are baked into the button
 * variants on purpose: a toolbar/header button must never wrap its label or
 * be the thing that shrinks when the row runs out of room. The one element
 * allowed to shrink is a dedicated hint/label slot styled locally with
 * `minWidth: 0` + `textOverflow: "ellipsis"`.
 */
export const controlStyles: Record<string, CSSProperties> = {
  /** Solid/primary-weight button (e.g. an emphasized action). Caller sets background/color. */
  button: {
    padding: "4px 10px",
    fontSize: 12,
    fontFamily: "inherit",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  /** Outlined/neutral button. Caller sets background/color/border color. */
  secondaryButton: {
    padding: "4px 10px",
    fontSize: 12,
    fontFamily: "inherit",
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    cursor: "pointer",
    background: "#fff",
    color: "#0f172a",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  /** Compact numeric/text input, e.g. inline quantity fields. */
  smallInput: {
    padding: "4px 6px",
    fontSize: 12,
    textAlign: "center",
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    fontFamily: "inherit",
  },
  /** One button inside a bordered `role="group"` segmented control — no border/radius of its own. */
  segmentedButton: {
    padding: "4px 10px",
    fontSize: 12,
    fontFamily: "inherit",
    border: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
};
