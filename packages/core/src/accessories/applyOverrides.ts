import type { QuantityOverrides } from "../types.js";
import type { AccessoryCount, CountByPour } from "./types.js";

/** Only clamps are overridable this round — see docs/open-questions.md §3. */
const OVERRIDABLE = ["cornerClamps", "straightClamps"] as const;
type OverridableField = (typeof OVERRIDABLE)[number];

export interface OverrideApplication {
  counts: CountByPour<AccessoryCount>;
  /** `${field}:${pourId}` → the automatic value that was replaced, for the UI hint */
  replaced: Map<string, number>;
}

/**
 * Substitutes hand-typed quantities for the engine's own, per pour, and
 * recomputes the totals from the effective values.
 *
 * Applied at the reporting boundary rather than inside the counters, so the
 * engine stays purely automatic and the BOM builder needs no new argument.
 *
 * The customer's real sheets type these numbers by hand (`74*3` where the
 * layout implies something else), so the engine has to leave room for that
 * rather than overwrite it.
 */
export function applyQuantityOverrides(
  counts: CountByPour<AccessoryCount>,
  overrides: QuantityOverrides | undefined
): OverrideApplication {
  const replaced = new Map<string, number>();
  if (!overrides) return { counts, replaced };

  const byPour: Record<string, AccessoryCount> = {};
  for (const [pourId, bucket] of Object.entries(counts.byPour)) {
    const next = { ...bucket };
    for (const field of OVERRIDABLE) {
      const value = overrides[field]?.[pourId];
      // Explicitly a number: 0 is a legitimate override, and a truthiness
      // check here would silently fall back to the automatic value.
      if (typeof value !== "number") continue;
      replaced.set(`${field}:${pourId}`, bucket[field]);
      next[field] = value;
    }
    byPour[pourId] = next;
  }

  const total = { ...counts.total };
  for (const field of OVERRIDABLE) {
    total[field] = Object.values(byPour).reduce((sum, bucket) => sum + bucket[field], 0);
  }

  return { counts: { byPour, total }, replaced };
}

/** The effective value for one cell, for the UI to render. */
export function effectiveQuantity(
  automatic: number,
  overrides: QuantityOverrides | undefined,
  field: OverridableField,
  pourId: string
): number {
  const value = overrides?.[field]?.[pourId];
  return typeof value === "number" ? value : automatic;
}
