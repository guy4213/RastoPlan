import type ExcelJS from "exceljs";
import { toGrid, type BomTemplate } from "@rastoplan/core";

/**
 * Serializes a BOM template to the .xlsx the customer feeds into Priority.
 *
 * The layout comes entirely from `toGrid` in core; this file deals only with
 * the file format and what is presentation rather than data: the sheet is
 * right-to-left like the originals, the header block and column header row
 * are bold, and the label column is wide enough for the Hebrew.
 *
 * ExcelJS is imported dynamically — it is by far the heaviest dependency in
 * the app and nothing needs it until someone actually exports.
 */
export async function bomWorkbook(template: BomTemplate): Promise<ExcelJS.Workbook> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("גיליון1", { views: [{ rightToLeft: true }] });

  for (const row of toGrid(template)) {
    sheet.addRow(row.map((cell) => cell ?? null));
  }

  const HEADER_ROWS = 5;
  const COLUMN_HEADER_ROW = 8;
  for (let i = 1; i <= HEADER_ROWS; i++) {
    sheet.getRow(i).getCell(1).font = { bold: true };
  }
  sheet.getRow(COLUMN_HEADER_ROW).font = { bold: true };

  sheet.getColumn(1).width = 32;
  for (let i = 2; i <= 4 + template.pourNames.length; i++) {
    sheet.getColumn(i).width = 16;
  }

  return workbook;
}

/** Triggers a browser download of the BOM as .xlsx. */
export async function downloadBomXlsx(template: BomTemplate, fileName: string): Promise<void> {
  const workbook = await bomWorkbook(template);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  // Attach to the DOM before clicking — Firefox ignores clicks on detached
  // anchors — and defer the revoke so browsers that dispatch the download
  // asynchronously (Safari, some Chromium versions on Windows) have time to
  // read the blob URL before it's torn down.
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
