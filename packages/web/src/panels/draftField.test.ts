import { describe, expect, it } from "vitest";
import {
  commitDraftField,
  initDraftFieldValueState,
  revertDraftField,
  syncDraftField,
  typeDraftField,
  type DraftFieldValueState,
} from "./draftField.js";

// A plain integer field: used across every test below so the sequences read
// as "what would happen in WallPanel's length field".
const intField = {
  parse: (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  },
  format: (n: number): string => String(n),
  equals: Object.is as (a: number, b: number) => boolean,
};

function commit(state: DraftFieldValueState<number>) {
  return commitDraftField(state, intField.parse, intField.format, intField.equals);
}

describe("initDraftFieldValueState / syncDraftField", () => {
  it("seeds draft, committed text, and committedValue from the given value", () => {
    expect(initDraftFieldValueState(300, intField.format)).toEqual({
      draft: "300",
      committed: "300",
      committedValue: 300,
    });
  });

  it("sync snaps draft, committed text, and committedValue to a new external value, even mid-edit", () => {
    let state: DraftFieldValueState<number> = initDraftFieldValueState(300, intField.format);
    state = typeDraftField(state, "999"); // user mid-edit, uncommitted
    state = syncDraftField(150, intField.format); // selection changed
    expect(state).toEqual({ draft: "150", committed: "150", committedValue: 150 });
  });
});

describe("typeDraftField", () => {
  it("updates only the draft; committed/committedValue are untouched", () => {
    const state = initDraftFieldValueState(300, intField.format);
    const next = typeDraftField(state, "4");
    expect(next).toEqual({ draft: "4", committed: "300", committedValue: 300 });
  });

  it("composing toward a longer number keeps every intermediate keystroke uncommitted", () => {
    let state = initDraftFieldValueState(300, intField.format);
    state = typeDraftField(state, "4");
    state = typeDraftField(state, "40");
    state = typeDraftField(state, "400");
    expect(state).toEqual({ draft: "400", committed: "300", committedValue: 300 });
  });
});

describe("revertDraftField (Escape)", () => {
  it("throws away the draft and restores the last committed text, without changing committedValue", () => {
    const state = typeDraftField(initDraftFieldValueState(300, intField.format), "garbage");
    const next = revertDraftField(state);
    expect(next).toEqual({ draft: "300", committed: "300", committedValue: 300 });
  });

  it("never reports a commit by itself — it only edits `state`, callers must not call onCommit for it", () => {
    // revertDraftField's return type has no `didCommit`/`value` at all, which is
    // itself the contract: Escape cannot accidentally be wired to dispatch.
    const state = revertDraftField(typeDraftField(initDraftFieldValueState(300, intField.format), "999"));
    expect(state.committedValue).toBe(300);
  });
});

describe("commitDraftField (Enter / blur)", () => {
  it("accepts a valid, changed draft: reports didCommit and the new value", () => {
    const state = typeDraftField(initDraftFieldValueState(300, intField.format), "400");
    const outcome = commit(state);
    expect(outcome.didCommit).toBe(true);
    expect(outcome.value).toBe(400);
    expect(outcome.state).toEqual({ draft: "400", committed: "400", committedValue: 400 });
  });

  it("reverts on invalid input instead of committing", () => {
    const state = typeDraftField(initDraftFieldValueState(300, intField.format), "abc");
    const outcome = commit(state);
    expect(outcome.didCommit).toBe(false);
    expect(outcome.value).toBeNull();
    expect(outcome.state).toEqual({ draft: "300", committed: "300", committedValue: 300 });
  });

  it("reverts on empty input instead of sending 0", () => {
    const state = typeDraftField(initDraftFieldValueState(300, intField.format), "");
    const outcome = commit(state);
    expect(outcome.didCommit).toBe(false);
    expect(outcome.state.draft).toBe("300");
  });

  it("a no-op re-commit of the already-committed value does not report a commit", () => {
    const state = initDraftFieldValueState(300, intField.format); // untouched, draft already "300"
    const outcome = commit(state);
    expect(outcome.didCommit).toBe(false);
  });

  // --- Regression coverage for the lead's correction (stale-closure double commit / Escape-still-commits) ---
  //
  // Both scenarios below chain two calls the way real event handlers do
  // (Enter-then-a-later-blur, Escape-then-a-later-blur) but operate on one
  // synchronously-threaded `state`, exactly like the `live` ref in
  // useDraftField.ts — never a React-render-lagged snapshot. A version of
  // this logic that instead compared a fresh commit attempt against a value
  // captured *before* the first action (e.g. a component prop that only
  // updates on the next render) would report a second, duplicate commit in
  // the first scenario, and would report a commit at all in the second.

  it("[type 450, Enter, blur] commits exactly once, with 450 — Enter's commit is not repeated by a later blur", () => {
    let state = initDraftFieldValueState(300, intField.format);
    state = typeDraftField(state, "450");

    const onEnter = commit(state); // Enter
    expect(onEnter.didCommit).toBe(true);
    expect(onEnter.value).toBe(450);

    const onBlur = commit(onEnter.state); // a later blur (Tab away, click elsewhere)
    expect(onBlur.didCommit).toBe(false); // must NOT fire onCommit a second time
    expect(onBlur.value).toBe(450); // parses fine, just already matches committedValue
  });

  it("[type 450, Escape, blur] never commits — Escape's revert is not overridden by a later blur", () => {
    let state = initDraftFieldValueState(300, intField.format);
    state = typeDraftField(state, "450");
    state = revertDraftField(state); // Escape

    const onBlur = commit(state); // a later blur
    expect(onBlur.didCommit).toBe(false);
    expect(onBlur.state.draft).toBe("300");
  });

  it("pressing Enter twice with no edit in between commits only on the first press", () => {
    let state = initDraftFieldValueState(300, intField.format);
    state = typeDraftField(state, "450");

    const first = commit(state);
    expect(first.didCommit).toBe(true);

    const second = commit(first.state);
    expect(second.didCommit).toBe(false);
  });

  it("normalizes the draft text after a commit (e.g. leading zeros), even when the value didn't change", () => {
    const state = typeDraftField(initDraftFieldValueState(300, intField.format), "0300");
    const outcome = commit(state);
    expect(outcome.didCommit).toBe(false); // 300 === 300, nothing to report
    expect(outcome.state.draft).toBe("300"); // but the text is cleaned up
  });
});
