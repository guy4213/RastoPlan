/**
 * Pure helpers for the numeric side-panel fields (length, thickness,
 * position). Kept separate from `useDraftField` so parsing/formatting rules
 * — which differ per field — can be unit tested without React.
 */

export interface ParseBoundedNumberOptions {
  min?: number;
  max?: number;
}

/**
 * Parses a side-panel numeric input. Accepts a comma as a decimal separator
 * (Hebrew keyboards/locales commonly produce one). Returns `null` for empty,
 * non-numeric, or out-of-range input so the caller can revert instead of
 * committing a bad value (e.g. clearing the field must never commit 0).
 */
export function parseBoundedNumber(raw: string, options: ParseBoundedNumberOptions = {}): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (options.min !== undefined && n < options.min) return null;
  if (options.max !== undefined && n > options.max) return null;
  return n;
}

/** Rounds to the given decimal precision and renders as a plain string (no trailing zeros). */
export function formatRounded(value: number, decimals = 0): string {
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

/** Tolerant equality for cm measurements, so retyping the same value doesn't re-dispatch. */
export function almostEqual(a: number, b: number, epsilon = 0.001): boolean {
  return Math.abs(a - b) < epsilon;
}
