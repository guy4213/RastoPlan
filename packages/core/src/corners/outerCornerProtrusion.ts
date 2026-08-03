import type { AccessoryRules } from "../types.js";

/**
 * Overlap in cm that a straight panel runs past a convex (outer) corner so it
 * laps over the panel on the neighbouring wall.
 *
 * The customer quotes 10cm as standard, but it isn't fixed: it depends on the
 * neighbouring wall's thickness and on which panel actually sits there. A
 * thicker neighbour eats into the lap, and once a smaller panel is used the
 * remainder is filled with timber and the lap drops to 5cm. So: every cm of
 * neighbour thickness beyond the reference costs a cm of overlap, bounded by
 * the customer's [min, standard] range.
 *
 * The two anchors (10 standard, 5 with timber fill) and the bounds are
 * confirmed; the 1:1 slope between them is our reading — see
 * docs/open-questions.md.
 */
export function outerCornerProtrusionFor(
  neighborThicknessCm: number,
  rules: AccessoryRules
): number {
  const {
    outerCornerProtrusionCm: standard,
    outerCornerProtrusionMinCm: min,
    outerCornerProtrusionReferenceThicknessCm: reference,
  } = rules;

  const eaten = neighborThicknessCm - reference;
  return Math.min(standard, Math.max(min, standard - eaten));
}
