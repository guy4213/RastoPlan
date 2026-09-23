/** Landscape ISO print sheets the export flow offers. */
export type PrintPageSize = "A3" | "A1" | "A0";

export interface PageDimensionsMm {
  widthMm: number;
  heightMm: number;
}

/** Landscape orientation — width is the longer edge. */
export const PRINT_PAGE_SIZES_MM: Record<PrintPageSize, PageDimensionsMm> = {
  A3: { widthMm: 420, heightMm: 297 },
  A1: { widthMm: 841, heightMm: 594 },
  A0: { widthMm: 1189, heightMm: 841 },
};

/** Standard architectural scale denominators (1:N), smallest N (largest drawing) first. */
export const STANDARD_PRINT_SCALES: readonly number[] = [
  20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000,
];

export interface PrintBoundsCm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ChoosePrintScaleResult {
  /** the N in "1:N" */
  scale: number;
  /** false when even the smallest standard scale (1:1000) does not fit */
  fits: boolean;
  printableWidthMm: number;
  printableHeightMm: number;
}

/**
 * The largest standard scale (smallest 1:N denominator) at which `boundsCm`
 * fits the sheet's printable area — the page minus its margin and, on the
 * height axis, the title block. Fitting is checked on both axes because the
 * plan's own aspect ratio need not match the sheet's.
 *
 * When nothing in STANDARD_PRINT_SCALES fits, returns the smallest scale
 * (largest N, 1:1000) with `fits: false` rather than silently picking
 * something that still overflows — a caller must decide what to do with an
 * oversized plan (e.g. offer a bigger sheet), not receive a false "it fits".
 */
export function choosePrintScale(
  boundsCm: PrintBoundsCm,
  page: PrintPageSize,
  marginMm: number,
  titleBlockMm: number
): ChoosePrintScaleResult {
  const { widthMm, heightMm } = PRINT_PAGE_SIZES_MM[page];
  const printableWidthMm = Math.max(0, widthMm - marginMm * 2);
  const printableHeightMm = Math.max(0, heightMm - marginMm * 2 - titleBlockMm);

  const widthCm = Math.max(0, boundsCm.maxX - boundsCm.minX);
  const heightCm = Math.max(0, boundsCm.maxY - boundsCm.minY);

  // At 1:N, 1cm of the real plan draws as (10 / N) mm on paper.
  const drawnWidthMm = (n: number) => (widthCm * 10) / n;
  const drawnHeightMm = (n: number) => (heightCm * 10) / n;

  const ascendingByN = [...STANDARD_PRINT_SCALES].sort((a, b) => a - b);
  for (const n of ascendingByN) {
    if (drawnWidthMm(n) <= printableWidthMm && drawnHeightMm(n) <= printableHeightMm) {
      return { scale: n, fits: true, printableWidthMm, printableHeightMm };
    }
  }

  const smallestScale = ascendingByN[ascendingByN.length - 1]!;
  return { scale: smallestScale, fits: false, printableWidthMm, printableHeightMm };
}
