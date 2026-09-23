import { useEffect, useReducer, useRef, type KeyboardEvent } from "react";
import {
  commitDraftField,
  initDraftFieldValueState,
  revertDraftField,
  syncDraftField,
  typeDraftField,
  type DraftFieldValueState,
} from "./draftField.js";

export interface UseDraftFieldOptions<T> {
  /** Parse the raw input text. Return `null` for invalid/unparseable input — the field reverts. */
  parse: (raw: string) => T | null;
  /** Render a value of T back into input text (also used to normalize the draft after a commit). */
  format: (value: T) => string;
  /** Compares a newly parsed value against what's already committed. Defaults to `Object.is`. */
  equals?: (a: T, b: T) => boolean;
  /** Called only when a commit's parsed value actually differs from what was already committed. */
  onCommit: (value: T) => void;
}

export interface DraftFieldHandle {
  /** Bind to the input's `value`. */
  value: string;
  onChange: (raw: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

/**
 * Buffers one controlled input against an externally authoritative value of
 * type `T` (a wall's length, a placement's offset, ...), so intermediate
 * keystrokes never dispatch and an in-progress edit can be cancelled.
 *
 * The authoritative draft/committed state lives in `live`, a ref mutated
 * SYNCHRONOUSLY by every action below (`commitDraftField` et al. from
 * `draftField.ts`). `bump` (a `useReducer` counter) only forces a re-render
 * so the input's displayed text follows `live`.
 *
 * This two-tier design replaced an earlier version that read the value
 * returned by `useReducer` directly inside `commit()`/`revert()` — i.e.
 * React state as of the last render, which lags one render behind a
 * `dispatch`. Combined with Enter/Escape forcing a `blur()` synchronously
 * (to "finish" the edit), that meant:
 * - Escape's revert was invisible to the blur it triggered: `onBlur` read
 *   the pre-revert draft and committed it anyway.
 * - Enter's commit, followed by its own forced blur, committed the SAME
 *   stale draft a second time — a duplicate `update-wall`/`update-placement`
 *   dispatch per Enter press.
 * Reading/writing `live` synchronously fixes both: a revert is visible to
 * any commit attempt that follows in the same tick, and a successful commit
 * updates `live.current.committedValue` immediately, so a second commit
 * attempt on the same unedited draft sees nothing new to report. Enter and
 * Escape also no longer force a blur at all — forcing one moved focus to
 * `<body>`, which broke Tab/Shift+Tab continuing from the field the user was
 * just in. Both keys now act and keep focus in place; a later real blur
 * (Tab, or clicking elsewhere) still commits, just harmlessly, since by then
 * there is nothing left to commit.
 *
 * Whenever `committedValue` changes — including while the field has focus —
 * the draft is unconditionally resynced to it. This mirrors this project's
 * pre-existing WallPanel behavior and is a deliberate constraint from the
 * P1-KEYBOARD brief, not an oversight (see that report for the two "typed
 * value discarded on selection change" bug suspects it preserves).
 */
export function useDraftField<T>(committedValue: T, options: UseDraftFieldOptions<T>): DraftFieldHandle {
  const equals = options.equals ?? Object.is;
  const live = useRef<DraftFieldValueState<T>>(initDraftFieldValueState(committedValue, options.format));
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const formatted = options.format(committedValue);
  useEffect(() => {
    live.current = syncDraftField(committedValue, options.format);
    bump();
    // Resetting on every external change — even mid-edit — is deliberate;
    // see the doc comment above.
  }, [formatted]);

  const commit = () => {
    const outcome = commitDraftField(live.current, options.parse, options.format, equals);
    live.current = outcome.state;
    bump();
    if (outcome.didCommit && outcome.value !== null) options.onCommit(outcome.value);
  };

  return {
    value: live.current.draft,
    onChange: (raw: string) => {
      live.current = typeDraftField(live.current, raw);
      bump();
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        // No blur: keep focus in the field so Tab/Shift+Tab continues from here.
      } else if (e.key === "Escape") {
        // The canvas's global Escape shortcut already ignores keydowns whose
        // target is a form field, but stop propagation here too so this can
        // never depend on that check living elsewhere.
        e.preventDefault();
        e.stopPropagation();
        live.current = revertDraftField(live.current);
        bump();
        // No blur here either: Escape cancels the edit but keeps focus put.
      }
    },
    onBlur: commit,
  };
}
