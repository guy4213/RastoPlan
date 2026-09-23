/**
 * Sizes the pour-name input to its content instead of stretching it to fill
 * the row: a short name like "יציקה 1" gets a small box, a long one gets a
 * wider one up to a cap, and anything past the cap keeps its full text (no
 * truncation of the stored value — see the `title` tooltip in PoursPanel)
 * while the input itself stays at the capped width.
 */
export const NAME_FIELD_MIN_CH = 8;
export const NAME_FIELD_MAX_CH = 24;

/** +1 leaves room for the text caret without immediately overflowing. */
export function nameFieldWidthCh(name: string): number {
  return Math.max(NAME_FIELD_MIN_CH, Math.min(NAME_FIELD_MAX_CH, name.length + 1));
}
