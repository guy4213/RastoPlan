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
 *
 * Implementation is a bounded knapsack DP keyed on (target-sum, leading-count)
 * → min-panels, so a long wall doesn't require enumerating every multiset —
 * the previous brute enumeration blew the heap for walls past ~10 m.
 */
export function selectPanels(
  rawClearLength: number,
  catalog: PanelCatalog,
  rules: AccessoryRules
): SelectPanelsResult {
  // The DP below is indexed by whole centimetres, so a fractional run would
  // match nothing and report the wall as untileable rather than off by 3mm.
  const clearLength = Math.round(rawClearLength);
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

  // Every catalog width is a whole cm and typically a multiple of 5, so any
  // gap producing a target the widths' gcd can't tile is a dead branch —
  // skip it before the DP touches it.
  const widthGcd = widths.length > 0 ? widths.reduce(gcd) : 1;

  const candidates: Candidate[] = [];
  for (const gap of gapValues) {
    const target = clearLength - gap;
    if (target < 0) continue;
    if (target > 0 && (widthGcd === 0 || target % widthGcd !== 0)) continue;
    for (const combo of paretoOptimalCombos(target, widths, widthToPanel)) {
      candidates.push({ ...combo, gap });
    }
  }

  if (candidates.length === 0) {
    return { panels: [], gap: 0, flags: ["gap-out-of-range"] };
  }

  candidates.sort(byTilingPriority(rules.tilingPriority));
  const best = candidates[0]!;

  return {
    panels: best.widths.map((w) => widthToPanel.get(w)!),
    gap: best.gap,
    flags: [],
  };
}

interface DpCell {
  /** min number of panels to reach this (target, leadingCount) state */
  count: number;
  /** back-pointer for reconstruction */
  prevT: number;
  prevL: number;
  width: number;
}

/**
 * For each achievable `leadingCount` L that hits exact sum `target` with the
 * given (unbounded) widths, returns the multiset with the minimum panel count
 * for that L. Different L values are all kept — the caller ranks them per
 * user-configurable tilingPriority.
 *
 * Standard unbounded-knapsack DP; complexity O(|widths| · target · L_max),
 * with L_max ≤ target / min-leading-width. Tiny in practice.
 */
function paretoOptimalCombos(
  target: number,
  widths: number[],
  widthToPanel: Map<number, Panel>
): { widths: number[]; leadingCount: number; panelCount: number }[] {
  if (target === 0) return [{ widths: [], leadingCount: 0, panelCount: 0 }];
  if (widths.length === 0) return [];

  const dp: (Map<number, DpCell> | undefined)[] = new Array(target + 1);
  dp[0] = new Map([[0, { count: 0, prevT: -1, prevL: -1, width: -1 }]]);

  for (const w of widths) {
    const isLeading = widthToPanel.get(w)?.isLeading === true;
    for (let t = w; t <= target; t++) {
      const prev = dp[t - w];
      if (!prev) continue;
      let cur = dp[t];
      for (const [L, cell] of prev) {
        const newL = L + (isLeading ? 1 : 0);
        const newCount = cell.count + 1;
        if (!cur) {
          cur = new Map();
          dp[t] = cur;
        }
        const existing = cur.get(newL);
        if (!existing || existing.count > newCount) {
          cur.set(newL, { count: newCount, prevT: t - w, prevL: L, width: w });
        }
      }
    }
  }

  const table = dp[target];
  if (!table) return [];

  const results: { widths: number[]; leadingCount: number; panelCount: number }[] = [];
  for (const [L, endCell] of table) {
    const widthsUsed: number[] = [];
    let cell = endCell;
    while (cell.count > 0) {
      widthsUsed.push(cell.width);
      const parent = dp[cell.prevT]!.get(cell.prevL)!;
      cell = parent;
    }
    results.push({ widths: widthsUsed, leadingCount: L, panelCount: endCell.count });
  }
  return results;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function byTilingPriority(
  priority: AccessoryRules["tilingPriority"]
): (a: Candidate, b: Candidate) => number {
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
