import type { AccessoryRules, Panel, PanelCatalog } from "../types.js";

export interface SelectPanelsResult {
  /** the chosen multiset of straight panels, in no particular order (arrangePanels handles ordering) */
  panels: Panel[];
  /** 0 for an exact fit, else the timber filler gap in cm */
  gap: number;
  /** ["gap-out-of-range"] when no combination fits — `panels` is empty in that case */
  flags: string[];
  /** Units needed to finish the selected layout but unavailable in stock. */
  missingPanelsByType: Readonly<Record<string, number>>;
}

/** Remaining physical units by panel type for the current pour. */
export type PanelAvailability = Readonly<Record<string, number>>;

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
  rules: AccessoryRules,
  availability?: PanelAvailability
): SelectPanelsResult {
  // The DP below is indexed by whole centimetres, so a fractional run would
  // match nothing and report the wall as untileable rather than off by 3mm.
  const clearLength = Math.round(rawClearLength);
  const straightInStock = catalog.panels.filter(
    (p) =>
      // Once a finite inventory exists it is the source of truth. Older app
      // versions copied zero stock into this coarse flag and persisted every
      // catalog type as false; honouring that stale bit here makes even a
      // newly imported positive quantity render as one red wall.
      (p.inStock || availability !== undefined) &&
      p.kind === "straight"
  );
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
    const combos = availability
      ? paretoOptimalBoundedCombos(target, widths, widthToPanel, availability)
      : paretoOptimalCombos(target, widths, widthToPanel);
    for (const combo of combos) {
      candidates.push({ ...combo, gap });
    }
  }

  if (candidates.length === 0 && availability) {
    const partialCandidates: PartialCandidate[] = [];
    for (const gap of gapValues) {
      const target = clearLength - gap;
      if (target < 0) continue;
      if (target > 0 && (widthGcd === 0 || target % widthGcd !== 0)) continue;
      const combo = bestPartialInventoryCombo(
        target,
        widths,
        widthToPanel,
        availability,
        rules.tilingPriority
      );
      if (combo) partialCandidates.push({ ...combo, gap });
    }

    partialCandidates.sort((a, b) => {
      const stockedCoverage = b.availableWidth - a.availableWidth;
      if (stockedCoverage !== 0) return stockedCoverage;
      const normalPriority = byTilingPriority(rules.tilingPriority)(a, b);
      if (normalPriority !== 0) return normalPriority;
      return a.missingCount - b.missingCount;
    });

    const best = partialCandidates[0];
    if (best) {
      return {
        panels: best.widths.map((w) => widthToPanel.get(w)!),
        gap: best.gap,
        flags: [],
        missingPanelsByType: best.missingPanelsByType,
      };
    }
  }

  if (candidates.length === 0) {
    return {
      panels: [],
      gap: 0,
      flags: ["gap-out-of-range"],
      missingPanelsByType: {},
    };
  }

  candidates.sort(byTilingPriority(rules.tilingPriority));
  const best = candidates[0]!;

  return {
    panels: best.widths.map((w) => widthToPanel.get(w)!),
    gap: best.gap,
    flags: [],
    missingPanelsByType: {},
  };
}

interface PartialCandidate extends Candidate {
  /** centimetres covered by physical panels that are actually in stock */
  availableWidth: number;
  /** number of selected units that must still be supplied */
  missingCount: number;
  missingPanelsByType: Record<string, number>;
}

/**
 * When stock cannot complete a run, choose a complete theoretical layout that
 * uses as much of the physical stock as possible. Counts beyond availability
 * remain explicit missing units instead of collapsing the whole run into one
 * red placeholder.
 */
function bestPartialInventoryCombo(
  target: number,
  widths: number[],
  widthToPanel: Map<number, Panel>,
  availability: PanelAvailability,
  priority: AccessoryRules["tilingPriority"]
): Omit<PartialCandidate, "gap"> | null {
  interface StockCell {
    widths: number[];
    leadingCount: number;
    panelCount: number;
  }

  // Bounded 0/1 knapsack over binary-split stock quantities. This computes
  // one best stocked combination for every covered width in O(target · log
  // stock), avoiding the quadratic partial-layout DP on long walls.
  const stockedByWidth: (StockCell | undefined)[] = new Array(target + 1);
  stockedByWidth[0] = { widths: [], leadingCount: 0, panelCount: 0 };
  for (const width of widths) {
    const panel = widthToPanel.get(width)!;
    let remaining = Math.min(
      Math.floor(target / width),
      Math.max(0, Math.floor(availability[panel.type] ?? 0))
    );
    let chunk = 1;
    while (remaining > 0) {
      const units = Math.min(chunk, remaining);
      const chunkWidth = units * width;
      for (let sum = target; sum >= chunkWidth; sum--) {
        const previous = stockedByWidth[sum - chunkWidth];
        if (!previous) continue;
        const candidate: StockCell = {
          widths: [...previous.widths, ...Array.from({ length: units }, () => width)],
          leadingCount: previous.leadingCount + (panel.isLeading ? units : 0),
          panelCount: previous.panelCount + units,
        };
        const existing = stockedByWidth[sum];
        if (!existing || compareTilingMetrics(candidate, existing, priority) < 0) {
          stockedByWidth[sum] = candidate;
        }
      }
      remaining -= units;
      chunk *= 2;
    }
  }

  // Stocked coverage is the primary goal. The first achievable stocked width
  // whose remainder has a legal theoretical tiling is therefore optimal.
  for (let stockedWidth = target; stockedWidth >= 0; stockedWidth--) {
    const stocked = stockedByWidth[stockedWidth];
    if (!stocked) continue;
    const missingCombos = paretoOptimalCombos(target - stockedWidth, widths, widthToPanel);
    const candidates = missingCombos.map((missing): Omit<PartialCandidate, "gap"> => {
      const missingPanelsByType: Record<string, number> = {};
      for (const width of missing.widths) {
        const type = widthToPanel.get(width)!.type;
        missingPanelsByType[type] = (missingPanelsByType[type] ?? 0) + 1;
      }
      return {
        widths: [...stocked.widths, ...missing.widths],
        availableWidth: stockedWidth,
        missingCount: missing.panelCount,
        missingPanelsByType,
        leadingCount: stocked.leadingCount + missing.leadingCount,
        panelCount: stocked.panelCount + missing.panelCount,
      };
    });
    candidates.sort((a, b) => comparePartialCell(a, b, priority));
    if (candidates[0]) return candidates[0];
  }

  return null;
}

function compareTilingMetrics(
  a: Pick<Candidate, "leadingCount" | "panelCount">,
  b: Pick<Candidate, "leadingCount" | "panelCount">,
  priority: AccessoryRules["tilingPriority"]
): number {
  for (const key of priority) {
    const diff =
      key === "leading"
        ? b.leadingCount - a.leadingCount
        : key === "min-panels"
          ? a.panelCount - b.panelCount
          : 0;
    if (diff !== 0) return diff;
  }
  return 0;
}

function comparePartialCell(
  a: Pick<PartialCandidate, "availableWidth" | "missingCount" | "leadingCount" | "panelCount">,
  b: Pick<PartialCandidate, "availableWidth" | "missingCount" | "leadingCount" | "panelCount">,
  priority: AccessoryRules["tilingPriority"]
): number {
  const stockedCoverage = b.availableWidth - a.availableWidth;
  if (stockedCoverage !== 0) return stockedCoverage;
  const normalPriority = compareTilingMetrics(a, b, priority);
  if (normalPriority !== 0) return normalPriority;
  return a.missingCount - b.missingCount;
}

/**
 * Bounded counterpart of the normal unbounded selector. Each width may be
 * used only as many times as remain in the current pour's inventory ledger.
 */
function paretoOptimalBoundedCombos(
  target: number,
  widths: number[],
  widthToPanel: Map<number, Panel>,
  availability: PanelAvailability
): { widths: number[]; leadingCount: number; panelCount: number }[] {
  interface Cell {
    widths: number[];
    panelCount: number;
  }

  let dp: (Map<number, Cell> | undefined)[] = new Array(target + 1);
  dp[0] = new Map([[0, { widths: [], panelCount: 0 }]]);

  for (const width of widths) {
    const panel = widthToPanel.get(width)!;
    const maxUse = Math.min(
      Math.floor(target / width),
      Math.max(0, Math.floor(availability[panel.type] ?? 0))
    );
    const next = dp.map((states) => (states ? new Map(states) : undefined));

    for (let sum = 0; sum <= target; sum++) {
      const states = dp[sum];
      if (!states) continue;
      for (const [leadingCount, cell] of states) {
        for (let used = 1; used <= maxUse && sum + used * width <= target; used++) {
          const nextSum = sum + used * width;
          const nextLeading = leadingCount + (panel.isLeading ? used : 0);
          const nextCount = cell.panelCount + used;
          let bucket = next[nextSum];
          if (!bucket) {
            bucket = new Map();
            next[nextSum] = bucket;
          }
          const existing = bucket.get(nextLeading);
          if (!existing || existing.panelCount > nextCount) {
            bucket.set(nextLeading, {
              widths: [...cell.widths, ...Array.from({ length: used }, () => width)],
              panelCount: nextCount,
            });
          }
        }
      }
    }
    dp = next;
  }

  const states = dp[target];
  if (!states) return [];
  return [...states.entries()].map(([leadingCount, cell]) => ({
    widths: cell.widths,
    leadingCount,
    panelCount: cell.panelCount,
  }));
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
