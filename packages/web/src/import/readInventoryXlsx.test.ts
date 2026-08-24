import { Workbook, type CellValue } from "exceljs";
import { describe, expect, it } from "vitest";
import { InventoryImportError, readInventoryXlsx } from "./readInventoryXlsx.js";

async function workbookData(rows: CellValue[][]): Promise<ArrayBuffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("גיליון1");
  rows.forEach((values, index) => {
    sheet.getRow(index + 1).values = [undefined, ...values];
  });
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("readInventoryXlsx", () => {
  it("finds the named columns and imports a blank stock cell as zero", async () => {
    const data = await workbookData([
      ["שם החברה :", null, "חברה"],
      [],
      [],
      [],
      [],
      [],
      [],
      ["תאור מוצר", "מלאי ", "כמות דרושה לפרוייקט"],
      ["פנאל 75/300", null, 8],
      ["פנאל 50/300", 6, 2],
      ["אביזרים :", null, null],
      ["אומים", "14", 10],
    ]);

    await expect(readInventoryXlsx(data)).resolves.toEqual({
      inventory: {
        "פנאל 75/300": 0,
        "פנאל 50/300": 6,
        "אומים": 14,
      },
      sheetName: "גיליון1",
      headerRow: 8,
      importedRows: 3,
    });
  });

  it.each([
    ["negative", -1],
    ["fraction", 1.5],
    ["text", "הרבה"],
  ])("rejects an invalid %s inventory value", async (_name, value) => {
    const data = await workbookData([
      ["תאור מוצר", "מלאי"],
      ["פנאל 75/300", value],
    ]);

    await expect(readInventoryXlsx(data)).rejects.toBeInstanceOf(InventoryImportError);
  });

  it("rejects duplicate product labels", async () => {
    const data = await workbookData([
      ["תאור מוצר", "מלאי"],
      ["פנאל 75/300", 2],
      ["פנאל 75/300", 3],
    ]);

    await expect(readInventoryXlsx(data)).rejects.toThrow("מופיע יותר מפעם אחת");
  });

  it("rejects a workbook without both required headers", async () => {
    const data = await workbookData([
      ["תאור מוצר", "כמות"],
      ["פנאל 75/300", 2],
    ]);

    await expect(readInventoryXlsx(data)).rejects.toThrow("לא נמצאה שורה");
  });
});
