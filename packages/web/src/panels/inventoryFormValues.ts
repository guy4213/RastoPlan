import { ACCESSORY_ITEMS, type PanelCatalog } from "@rastoplan/core";
import type { Action } from "../state/project.js";

/**
 * Every product label the manual inventory form offers a field for: every
 * panel in the project's catalog (by its exact BOM label) plus every
 * accessory item the customer's sheets carry a `מלאי` column for. This is
 * the same label universe `readInventoryXlsx` accepts from a product
 * column — that importer has no hardcoded list because it reads whatever
 * labels the workbook's product column contains — listed explicitly here so
 * a manual entry has a fixed field for each one instead of requiring a file.
 */
export function inventoryLabels(catalog: PanelCatalog): string[] {
  const labels = new Set<string>();
  for (const panel of catalog.panels) labels.add(panel.bomLabel);
  for (const item of Object.values(ACCESSORY_ITEMS)) labels.add(item.label);
  return [...labels];
}

/**
 * Current inventory record → one editable string per label. A label absent
 * from `inventory` (including when the project has no inventory at all yet)
 * prefills as "0", matching the exact-label/zero-if-missing semantics the
 * Excel importer already established for `Project.inventory`.
 */
export function inventoryToFormValues(
  labels: readonly string[],
  inventory: Record<string, number> | undefined
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const label of labels) {
    values[label] = String(normalizeQuantity(inventory?.[label]));
  }
  return values;
}

/**
 * One field's raw text → a non-negative integer. Empty, non-numeric, and
 * negative input all normalize to 0 rather than being rejected — exactly
 * what `set-inventory` already does for an imported value (see
 * `state/project.ts`), so a blank or invalid manual field has the same
 * effect as a row left out of an Excel import, not a stuck/blocked Save.
 */
export function parseInventoryFieldValue(raw: string): number {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return 0;
  return normalizeQuantity(Number(trimmed));
}

function normalizeQuantity(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : 0;
}

/** Every field's text → the exact `Record<bomLabel, number>` shape `set-inventory` expects. */
export function formValuesToInventory(values: Record<string, string>): Record<string, number> {
  const inventory: Record<string, number> = {};
  for (const [label, raw] of Object.entries(values)) {
    inventory[label] = parseInventoryFieldValue(raw);
  }
  return inventory;
}

/**
 * The exact action the Excel import path already dispatches for a finished
 * inventory read (see `importInventory` in QuantitiesPanel.tsx) — the manual
 * form reuses the same action and payload shape so both paths flow through
 * one reducer case.
 */
export function buildSetInventoryAction(values: Record<string, string>): Extract<Action, { type: "set-inventory" }> {
  return { type: "set-inventory", inventory: formValuesToInventory(values) };
}
