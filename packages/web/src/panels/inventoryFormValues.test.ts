import { describe, expect, it } from "vitest";
import { ACCESSORY_ITEMS, DEFAULT_PANEL_CATALOG } from "@rastoplan/core";
import {
  buildSetInventoryAction,
  formValuesToInventory,
  inventoryLabels,
  inventoryToFormValues,
  parseInventoryFieldValue,
} from "./inventoryFormValues.js";

describe("inventoryLabels", () => {
  it("lists every catalog panel by its exact bomLabel", () => {
    const labels = inventoryLabels(DEFAULT_PANEL_CATALOG);
    for (const panel of DEFAULT_PANEL_CATALOG.panels) {
      expect(labels).toContain(panel.bomLabel);
    }
  });

  it("also lists every accessory item the customer's sheets carry a מלאי column for", () => {
    const labels = inventoryLabels(DEFAULT_PANEL_CATALOG);
    for (const item of Object.values(ACCESSORY_ITEMS)) {
      expect(labels).toContain(item.label);
    }
  });

  it("has no duplicate labels", () => {
    const labels = inventoryLabels(DEFAULT_PANEL_CATALOG);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("inventoryToFormValues", () => {
  it("prefills a known label from the current inventory record", () => {
    const values = inventoryToFormValues(["פנאל 75/300", "פנאל 40/300"], {
      "פנאל 75/300": 12,
    });
    expect(values["פנאל 75/300"]).toBe("12");
  });

  it("defaults a label missing from the record to \"0\", including when there is no inventory at all", () => {
    const values = inventoryToFormValues(["פנאל 40/300"], undefined);
    expect(values["פנאל 40/300"]).toBe("0");

    const partial = inventoryToFormValues(["פנאל 40/300", "פנאל 75/300"], { "פנאל 75/300": 5 });
    expect(partial["פנאל 40/300"]).toBe("0");
  });

  it("floors a fractional stored quantity and treats a negative one as 0, same as the reducer", () => {
    const values = inventoryToFormValues(["a", "b"], { a: 12.7, b: -3 });
    expect(values.a).toBe("12");
    expect(values.b).toBe("0");
  });
});

describe("parseInventoryFieldValue", () => {
  it("parses a plain non-negative integer", () => {
    expect(parseInventoryFieldValue("12")).toBe(12);
    expect(parseInventoryFieldValue("0")).toBe(0);
  });

  it("floors a fractional entry", () => {
    expect(parseInventoryFieldValue("12.9")).toBe(12);
  });

  it("accepts a comma decimal separator, matching the side-panel number fields", () => {
    expect(parseInventoryFieldValue("12,9")).toBe(12);
  });

  it("normalizes empty input to 0 rather than leaving it unparseable", () => {
    expect(parseInventoryFieldValue("")).toBe(0);
    expect(parseInventoryFieldValue("   ")).toBe(0);
  });

  it("normalizes negative and non-numeric input to 0", () => {
    expect(parseInventoryFieldValue("-5")).toBe(0);
    expect(parseInventoryFieldValue("abc")).toBe(0);
    expect(parseInventoryFieldValue("NaN")).toBe(0);
  });
});

describe("formValuesToInventory", () => {
  it("converts every field to the exact Record<bomLabel, number> shape set-inventory expects", () => {
    const inventory = formValuesToInventory({
      "פנאל 75/300": "12",
      "פנאל 40/300": "",
      "פנאל 30/30/300": "-4",
      "קלמרה רגילה לתבניות GT": "8.6",
    });

    expect(inventory).toEqual({
      "פנאל 75/300": 12,
      "פנאל 40/300": 0,
      "פנאל 30/30/300": 0,
      "קלמרה רגילה לתבניות GT": 8,
    });
  });

  it("round-trips through inventoryToFormValues for a well-formed inventory record", () => {
    const original = { "פנאל 75/300": 12, "פנאל 90/300": 3 };
    const labels = Object.keys(original);
    const roundTripped = formValuesToInventory(inventoryToFormValues(labels, original));
    expect(roundTripped).toEqual(original);
  });
});

describe("buildSetInventoryAction", () => {
  it("dispatches the same action shape the Excel import path uses", () => {
    const action = buildSetInventoryAction({ "פנאל 75/300": "12", "פנאל 40/300": "abc" });

    expect(action.type).toBe("set-inventory");
    expect(action.inventory).toEqual({ "פנאל 75/300": 12, "פנאל 40/300": 0 });
  });
});
