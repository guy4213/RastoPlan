/**
 * Pure decision logic behind every buffered side-panel input (see
 * `useDraftField.ts`). Kept free of React so it can be unit tested in the
 * `node` vitest environment this package already uses for state logic — in
 * particular so the Enter/Escape/blur interaction can be regression-tested
 * as plain function calls, with no DOM and no React render-timing involved.
 *
 * `draft` is whatever text currently sits in the input. `committed` is that
 * same text once it was last agreed to be correct — either because the
 * caller's authoritative value changed (`syncDraftField`) or because a user
 * edit was accepted (`commitDraftField`). `committedValue` is the *parsed*
 * form of `committed`, kept alongside it so `commitDraftField` can decide
 * whether a newly parsed value actually differs from what's already
 * committed — without needing to re-parse `committed` or ask a component
 * for React state that might be a render behind.
 */
export interface DraftFieldValueState<T> {
  draft: string;
  committed: string;
  committedValue: T;
}

export function initDraftFieldValueState<T>(committedValue: T, format: (value: T) => string): DraftFieldValueState<T> {
  const committed = format(committedValue);
  return { draft: committed, committed, committedValue };
}

/** A keystroke: only the draft text changes. */
export function typeDraftField<T>(state: DraftFieldValueState<T>, raw: string): DraftFieldValueState<T> {
  return { ...state, draft: raw };
}

/** Escape: throw away the in-progress edit, go back to the last committed text. Never commits. */
export function revertDraftField<T>(state: DraftFieldValueState<T>): DraftFieldValueState<T> {
  return { ...state, draft: state.committed };
}

/**
 * The authoritative value changed from outside (a different wall/placement
 * got selected, a recompute ran, ...). Draft, committed text, and the
 * committed value all snap to it — even if the user was mid-edit. This is
 * intentional, not an oversight: see the P1-KEYBOARD report for the two
 * known "typed value gets discarded on selection change" bug suspects this
 * preserves rather than silently fixes.
 */
export function syncDraftField<T>(committedValue: T, format: (value: T) => string): DraftFieldValueState<T> {
  return initDraftFieldValueState(committedValue, format);
}

export interface CommitOutcome<T> {
  state: DraftFieldValueState<T>;
  /** true only when `onCommit` should actually be called. */
  didCommit: boolean;
  /** The parsed value when parsing succeeded (regardless of `didCommit`); `null` on invalid input. */
  value: T | null;
}

/**
 * Enter or blur: parse the current draft and either revert (invalid input)
 * or accept it.
 *
 * Accepting means the returned state's `committedValue` becomes the parsed
 * value immediately — not on some later render. That is what makes calling
 * this twice in a row for the same edit (e.g. Enter's commit immediately
 * followed by a leftover/real blur) safe: the second call compares the
 * (unchanged) draft's parsed value against the *already-updated*
 * `committedValue` from the first call, finds them equal, and reports
 * `didCommit: false`. A version of this that instead compared against a
 * value captured before the first call — such as a component prop that only
 * updates on the next render — would report `didCommit: true` twice for one
 * user edit.
 */
export function commitDraftField<T>(
  state: DraftFieldValueState<T>,
  parse: (raw: string) => T | null,
  format: (value: T) => string,
  equals: (a: T, b: T) => boolean
): CommitOutcome<T> {
  const parsed = parse(state.draft);
  if (parsed === null) {
    return { state: { ...state, draft: state.committed }, didCommit: false, value: null };
  }
  const didCommit = !equals(parsed, state.committedValue);
  const formatted = format(parsed);
  const next: DraftFieldValueState<T> = { draft: formatted, committed: formatted, committedValue: parsed };
  return { state: next, didCommit, value: parsed };
}
