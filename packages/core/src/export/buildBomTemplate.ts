import type { Panel, PanelCatalog } from "../types.js";
import type { AccessoryCount, CountByPour, PanelCount } from "../accessories/types.js";
import { ACCESSORY_ITEMS, BOM_CORNER_PANEL_LEGS, STRAIGHT_PANEL_WIDTHS } from "../defaults.js";

/** Header block above the product table, rows 1-5 of the customer's sheet. */
export interface BomHeader {
  companyName: string;
  projectName: string;
  note: string;
  date: string;
}

export interface BomRow {
  /** exact Hebrew product label — this is the key Priority ingests */
  label: string;
  /** m² per unit; null for accessory rows, which the customer leaves blank */
  sqmPerUnit: number | null;
  /** units to rent/buy: the MAX across pours, not the sum (panels move between pours) */
  requiredQty: number;
  /** requiredQty × sqmPerUnit; null wherever sqmPerUnit is */
  totalSqm: number | null;
  /** quantity per pour, in `pourNames` order */
  perPour: number[];
  /** section separators like "חצאי פנאלים :" carry no numbers of their own */
  isSectionLabel: boolean;
}

export interface BomTemplate {
  header: BomHeader;
  pourNames: string[];
  rows: BomRow[];
  /** sum of totalSqm over the panel rows — the sheet's `סה"כ מ"ר` */
  totalSqm: number;
}

export interface BuildBomTemplateInput {
  header: BomHeader;
  catalog: PanelCatalog;
  /** pour ids in display order; column order follows this */
  pourIds: string[];
  pourNames: string[];
  panels: CountByPour<PanelCount>;
  accessories: CountByPour<AccessoryCount>;
}

const TABLE_HEADERS = [
  "תאור מוצר",
  "כמות דרושה לפרוייקט",
  "מר לתבנית",
  'סה"כ מר ',
];

// Which straight widths and corner-leg sizes get a row here comes from the
// catalog definitions in defaults.ts — see STRAIGHT_PANEL_WIDTHS and
// BOM_CORNER_PANEL_LEGS. Duplicating them locally used to drift silently.

/**
 * Builds the customer's bill of materials in the exact shape of the sheets
 * they hand to Priority: same header block, same column headers, same product
 * rows in the same order, zeros where a row is unused.
 *
 * Two details that are easy to get wrong and are taken from their formulas:
 * - "כמות דרושה לפרוייקט" is `=MAX(...)` across the pour columns, not a sum.
 *   Formwork is reused between pours, so what has to be on site is the
 *   busiest single pour, not the running total.
 * - a corner panel's m² covers BOTH legs (30/30/300 → (30+30)/100×3 = 1.8),
 *   which is why `secondLegWidth` exists in the catalog.
 */
export function buildBomTemplate(input: BuildBomTemplateInput): BomTemplate {
  const { catalog, pourIds, pourNames, panels, accessories } = input;
  const panelByBomLabel = new Map(catalog.panels.map((p) => [p.bomLabel, p]));

  const panelRow = (label: string, fallbackSqm: number): BomRow => {
    const panel = panelByBomLabel.get(label);
    const perPour = pourIds.map((id) => quantityOf(panels.byPour[id], panel));
    const sqmPerUnit = panel ? sqmPerPanel(panel) : fallbackSqm;
    const requiredQty = maxOf(perPour);
    return {
      label,
      sqmPerUnit,
      requiredQty,
      totalSqm: round2(requiredQty * sqmPerUnit),
      perPour,
      isSectionLabel: false,
    };
  };

  const accessoryRow = (label: string, pick: (c: AccessoryCount) => number): BomRow => {
    const perPour = pourIds.map((id) => {
      const bucket = accessories.byPour[id];
      return bucket ? pick(bucket) : 0;
    });
    return {
      label,
      sqmPerUnit: null,
      requiredQty: maxOf(perPour),
      totalSqm: null,
      perPour,
      isSectionLabel: false,
    };
  };

  const sectionRow = (label: string): BomRow => ({
    label,
    sqmPerUnit: null,
    requiredQty: 0,
    totalSqm: null,
    perPour: pourIds.map(() => 0),
    isSectionLabel: true,
  });

  const panelRows = [
    ...STRAIGHT_PANEL_WIDTHS.map((w) => panelRow(`פנאל ${w}/300`, (w / 100) * 3)),
    ...BOM_CORNER_PANEL_LEGS.map((leg) => panelRow(`פנאל ${leg}/${leg}/300`, ((leg * 2) / 100) * 3)),
  ];

  const rows: BomRow[] = [
    ...panelRows,
    sectionRow("חצאי פנאלים :"),
    sectionRow("אביזרים :"),
    accessoryRow(ACCESSORY_ITEMS.straightClamp.label, (c) => c.straightClamps),
    accessoryRow(ACCESSORY_ITEMS.cornerClamp.label, (c) => c.cornerClamps),
    accessoryRow(ACCESSORY_ITEMS.craneAdapter.label, () => accessories.total.craneAdapters),
    // The walkway and the strut come as a pair in every sheet we have, always
    // at the same quantity, so one strut count feeds both rows.
    accessoryRow(ACCESSORY_ITEMS.walkway.label, (c) => c.struts),
    accessoryRow(ACCESSORY_ITEMS.strut.label, (c) => c.struts),
    accessoryRow(ACCESSORY_ITEMS.dywidag.label, (c) => c.dywidagRods),
    accessoryRow(ACCESSORY_ITEMS.nut.label, (c) => c.nuts),
  ];

  return {
    header: input.header,
    pourNames,
    rows,
    totalSqm: round2(panelRows.reduce((sum, r) => sum + (r.totalSqm ?? 0), 0)),
  };
}

/**
 * The template as a cell grid, 0-indexed by row then column, laid out exactly
 * like the customer's file: header block on rows 1-5, blank 6-7, column
 * headers on row 8, products from row 9 down.
 */
export function toGrid(template: BomTemplate): (string | number | null)[][] {
  const width = TABLE_HEADERS.length + template.pourNames.length;
  const blank = (): (string | number | null)[] => Array.from({ length: width }, () => null);

  const labelled = (label: string, value: string | number): (string | number | null)[] => {
    const row = blank();
    row[0] = label;
    row[1] = value;
    return row;
  };

  const grid: (string | number | null)[][] = [
    labelled("שם החברה :", template.header.companyName),
    labelled("שם הפרוייקט :", template.header.projectName),
    labelled("הערה :", template.header.note),
    labelled("תאריך :", template.header.date),
    labelled('סה"כ מ"ר :', template.totalSqm),
    blank(),
    blank(),
    [...TABLE_HEADERS, ...template.pourNames],
  ];

  for (const row of template.rows) {
    grid.push([row.label, row.requiredQty, row.sqmPerUnit, row.totalSqm, ...row.perPour]);
  }

  return grid;
}

function sqmPerPanel(panel: Panel): number {
  const heightM = panel.height / 100;
  const widthM = (panel.width + (panel.secondLegWidth ?? 0)) / 100;
  return round2(widthM * heightM);
}

function quantityOf(bucket: PanelCount | undefined, panel: Panel | undefined): number {
  if (!bucket || !panel) return 0;
  return bucket.byType[panel.type] ?? 0;
}

function maxOf(values: number[]): number {
  return values.reduce((max, v) => (v > max ? v : max), 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
