import type ExcelJS from "exceljs";

export interface InventoryImportResult {
  /** exact BOM product label → available units */
  inventory: Record<string, number>;
  sheetName: string;
  headerRow: number;
  importedRows: number;
}

export class InventoryImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryImportError";
  }
}

/**
 * Reads the customer's BOM workbook and imports column `מלאי`.
 *
 * Columns are located by their row-8 labels rather than fixed letters, so the
 * importer survives an extra metadata column. Product identity is the exact
 * text in `תאור מוצר`, the same key used by the catalog and BOM exporter.
 * Blank inventory is deliberately ZERO — the customer confirmed that blank
 * means the item does not exist, not unlimited stock.
 */
export async function readInventoryXlsx(
  data: ArrayBuffer
): Promise<InventoryImportResult> {
  const excelJs = await import("exceljs");
  // ExcelJS is CommonJS. Vite exposes the named export, while direct ESM
  // execution exposes it under `default`; support both shapes.
  const Workbook = excelJs.Workbook ?? excelJs.default.Workbook;
  const workbook = new Workbook();
  await workbook.xlsx.load(data);

  for (const sheet of workbook.worksheets) {
    const header = findHeader(sheet);
    if (!header) continue;

    const inventory: Record<string, number> = {};
    let importedRows = 0;

    for (let rowNumber = header.row + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const label = cellText(row.getCell(header.productColumn).value).trim();
      if (!label || isSectionLabel(label)) continue;
      if (Object.prototype.hasOwnProperty.call(inventory, label)) {
        throw new InventoryImportError(`הפריט "${label}" מופיע יותר מפעם אחת (שורה ${rowNumber})`);
      }

      inventory[label] = inventoryCount(row.getCell(header.inventoryColumn).value, rowNumber, label);
      importedRows++;
    }

    if (importedRows === 0) {
      throw new InventoryImportError("נמצאה כותרת מלאי, אבל לא נמצאו שורות מוצרים");
    }

    return {
      inventory,
      sheetName: sheet.name,
      headerRow: header.row,
      importedRows,
    };
  }

  throw new InventoryImportError('לא נמצאה שורה שמכילה את הכותרות "תאור מוצר" ו־"מלאי"');
}

function findHeader(
  sheet: ExcelJS.Worksheet
): { row: number; productColumn: number; inventoryColumn: number } | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber++) {
    const row = sheet.getRow(rowNumber);
    let productColumn = 0;
    let inventoryColumn = 0;
    for (let column = 1; column <= Math.max(sheet.columnCount, 2); column++) {
      const text = normalizeHeader(cellText(row.getCell(column).value));
      if (text === "תאור מוצר" || text === "תיאור מוצר") productColumn = column;
      if (text === "מלאי") inventoryColumn = column;
    }
    if (productColumn > 0 && inventoryColumn > 0) {
      return { row: rowNumber, productColumn, inventoryColumn };
    }
  }
  return null;
}

function inventoryCount(value: ExcelJS.CellValue, row: number, label: string): number {
  const raw = formulaResult(value);
  if (raw === null || raw === undefined || raw === "") return 0;

  const parsed =
    typeof raw === "number"
      ? raw
      : Number(cellText(raw as ExcelJS.CellValue).trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new InventoryImportError(
      `המלאי של "${label}" בשורה ${row} חייב להיות מספר שלם שאינו שלילי`
    );
  }
  return parsed;
}

function formulaResult(value: ExcelJS.CellValue): ExcelJS.CellValue {
  if (value && typeof value === "object" && "result" in value) {
    return (value as ExcelJS.CellFormulaValue).result ?? null;
  }
  return value;
}

function cellText(value: ExcelJS.CellValue): string {
  const raw = formulaResult(value);
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  if (typeof raw === "object" && "richText" in raw) {
    return raw.richText.map((part) => part.text).join("");
  }
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isSectionLabel(label: string): boolean {
  return label.trim().endsWith(":");
}
