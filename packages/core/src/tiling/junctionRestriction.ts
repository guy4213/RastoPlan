import type { NodeType, Panel, PanelCatalog, Placement } from "../types.js";

/**
 * Whether a panel may be used on a wall segment whose ends are `endNodeTypes`.
 *
 * A restriction is a prohibition: an unrestricted panel is always allowed, and
 * a restricted one needs at least ONE end of an allowed type. Segments whose
 * ends are unknown (an empty list) allow no restricted panel — the engine must
 * never place a T-only panel on a wall it cannot show is at a T.
 */
export function panelAllowedAtEnds(panel: Panel, endNodeTypes: readonly NodeType[]): boolean {
  const allowed = panel.allowedAtNodeTypes;
  if (!allowed) return true;
  return endNodeTypes.some((type) => allowed.includes(type));
}

/**
 * The segment qualifies for a restricted panel at one end but not the other —
 * e.g. a T at one end and an L at the other. The approved rule accepts this
 * (panel order follows the middle rule, which keeps Dywidag symmetry) and only
 * asks that it be reported, because the panel can land at the non-T end.
 */
export function restrictedPanelMayLandOffJunction(panel: Panel, endNodeTypes: readonly NodeType[]): boolean {
  const allowed = panel.allowedAtNodeTypes;
  if (!allowed || !panelAllowedAtEnds(panel, endNodeTypes)) return false;
  return endNodeTypes.some((type) => !allowed.includes(type));
}

/** Flag carried by a hand-placed panel the junction restriction forbids on its wall. */
export const JUNCTION_RESTRICTED_FLAG = "junction-restricted";

/**
 * Re-derives JUNCTION_RESTRICTED_FLAG for one placement: added when its panel
 * type is restricted and the wall's ends do not qualify, removed otherwise.
 * Other flags are left as they are. Manual placements are allowed but flagged
 * (approved rule), so this never drops or moves the placement.
 */
export function withJunctionRestrictionFlag(
  placement: Placement,
  catalog: PanelCatalog,
  endNodeTypes: readonly NodeType[] | undefined
): Placement {
  const panel =
    placement.kind === "panel" ? catalog.panels.find((p) => p.type === placement.panelType) : undefined;
  const violates = !!panel && endNodeTypes !== undefined && !panelAllowedAtEnds(panel, endNodeTypes);
  const others = placement.flags.filter((f) => f !== JUNCTION_RESTRICTED_FLAG);
  const flags = violates ? [...others, JUNCTION_RESTRICTED_FLAG] : others;
  const unchanged =
    flags.length === placement.flags.length && flags.every((f, i) => f === placement.flags[i]);
  return unchanged ? placement : { ...placement, flags };
}
