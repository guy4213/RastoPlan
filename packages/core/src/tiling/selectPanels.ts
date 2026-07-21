import type { AccessoryRules, Panel, PanelCatalog } from "../types.js";

export interface SelectPanelsResult {
  /** the chosen multiset of straight panels, in no particular order (arrangePanels handles ordering) */
  panels: Panel[];
  /** 0 for an exact fit, else the timber filler gap in cm */
  gap: number;
  /** ["gap-out-of-range"] when no combination fits — `panels` is empty in that case */
  flags: string[];
}

interface Candidate {
  widths: number[];
  gap: number;
}

interface ScoredCandidate extends Candidate {
  leadingCount: number;
  panelCount: number;
}

/**
 * Finds a multiset of in-stock, straight (non-corner) catalog panel widths
 * whose total either exactly equals clearLength, or falls short by a gap
 * within [rules.timberGapMin, rules.timberGapMax] (filled with on-site
 * timber). Assumes clearLength, widths, and gap bounds are whole
 * centimeters, matching how the domain is specified throughout the spec.
 *
 * Among all valid combinations, ranks by rules.tilingPriority (in the
 * order given): 'leading' maximizes leading-panel count, 'min-panels'
 * minimizes panel count, 'min-gap' minimizes the timber gap.
 */
export function selectPanels(
  clearLength: number,
  catalog: PanelCatalog,
  rules: AccessoryRules
): SelectPanelsResult {
  const straightInStock = catalog.panels.filter((p) => p.inStock && p.kind === "straight");
  const widthToPanel = new Map<number, Panel>();
  for (const panel of straightInStock) {
    if (!widthToPanel.has(panel.width)) widthToPanel.set(panel.width, panel);
  }
  const widths = [...widthToPanel.keys()].sort((a, b) => b - a);

  const gapValues = [0];
  for (let g = Math.ceil(rules.timberGapMin); g <= Math.floor(rules.timberGapMax); g++) {
    gapValues.push(g);
  }

  const candidates: Candidate[] = [];
  for (const gap of gapValues) {
    const target = clearLength - gap;
    if (target < 0) continue;
    for (const combo of findCombosSummingTo(target, widths)) {
      candidates.push({ widths: combo, gap });
    }
  }

  if (candidates.length === 0) {
    return { panels: [], gap: 0, flags: ["gap-out-of-range"] };
  }

  const scored: ScoredCandidate[] = candidates.map((c) => ({
    ...c,
    leadingCount: c.widths.filter((w) => widthToPanel.get(w)?.isLeading).length,
    panelCount: c.widths.length,
  }));

  scored.sort(byTilingPriority(rules.tilingPriority));
  const best = scored[0]!;

  return {
    panels: best.widths.map((w) => widthToPanel.get(w)!),
    gap: best.gap,
    flags: [],
  };
}

/** All multisets of `widths` (each usable any number of times) summing to exactly `target`. */
function findCombosSummingTo(target: number, widths: number[]): number[][] {
  const results: number[][] = [];

  function recurse(remaining: number, index: number, current: number[]): void {
    if (remaining === 0) {
      results.push([...current]);
      return;
    }
    if (index === widths.length) return;

    const width = widths[index]!;
    const maxCount = Math.floor(remaining / width);
    for (let count = maxCount; count >= 0; count--) {
      for (let i = 0; i < count; i++) current.push(width);
      recurse(remaining - count * width, index + 1, current);
      current.length -= count;
    }
  }

  recurse(target, 0, []);
  return results;
}

function byTilingPriority(
  priority: AccessoryRules["tilingPriority"]
): (a: ScoredCandidate, b: ScoredCandidate) => number {
  return (a, b) => {
    for (const key of priority) {
      const diff =
        key === "leading"
          ? b.leadingCount - a.leadingCount
          : key === "min-panels"
            ? a.panelCount - b.panelCount
            : a.gap - b.gap; // 'min-gap'
      if (diff !== 0) return diff;
    }
    return 0;
  };
}
