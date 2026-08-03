import type { AccessoryRules } from "../types.js";

/** Rod length class. The exact length of "long" is still open with the customer. */
export type DywidagRodLength = "standard-1m" | "long";

/**
 * Which rod a wall needs, by its thickness. The customer was unambiguous
 * here: up to 30cm a standard 1m Dywidag does the job, above that a longer
 * rod is required. The longer rod's actual length was not given.
 */
export function classifyDywidagLength(
  thicknessCm: number,
  rules: AccessoryRules
): DywidagRodLength {
  return thicknessCm <= rules.dywidagStandardMaxThicknessCm ? "standard-1m" : "long";
}

/**
 * Rods per tie point.
 *
 * TODO(customer meeting): the QUANTITY rule is still unknown and deliberately
 * not guessed. The three sources we have disagree, so no formula can be
 * derived from them:
 *   - the customer's clean template sheet: `=48*1.5`, i.e. 1.5 rods per panel
 *   - נפתלי ניסן קרית גת B: 86 rods for 88 panels (0.98)
 *   - אינטר בי בית שמש: 212 rods for 228 panels (0.93)
 * What's missing is whether the count is per panel, per m², or per pour
 * height, plus the edge distances from the supplied thickness table. Until
 * then this keeps the previous per-tie-point behaviour unchanged so the
 * number doesn't silently drift. `nuts = rods × 2` IS confirmed by all four
 * sheets. See docs/open-questions.md.
 */
export function dywidagRodsForJoint(rules: AccessoryRules): number {
  return rules.dywidagPerRod;
}
