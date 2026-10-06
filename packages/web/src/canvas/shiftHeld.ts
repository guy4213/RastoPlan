import { useEffect, useState } from "react";

/**
 * Whether Shift is held right now, shared by every canvas consumer.
 *
 * Shift inverts the ortho baseline while held, and two independent places need
 * that answer: the wall being drawn in Canvas and the endpoint being dragged in
 * Walls. A single window listener keeps them from disagreeing — two separate
 * listeners would drift the moment one component unmounted mid-gesture.
 *
 * Deliberately not in the reducer. Dispatching on every Shift press would put a
 * key-repeat-rate stream of renders through the whole project state, and the
 * pointer handlers need to read the value synchronously mid-gesture anyway,
 * which `isShiftHeld()` gives them without a dependency.
 */
let held = false;
const subscribers = new Set<(value: boolean) => void>();
let listening = false;

function set(value: boolean): void {
  if (held === value) return;
  held = value;
  for (const notify of subscribers) notify(value);
}

function startListening(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Shift") set(true);
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") set(false);
  });
  // Alt+Tab away with Shift down and the keyup never arrives, which would
  // leave the mode inverted with nothing on screen explaining why.
  window.addEventListener("blur", () => set(false));
}

/** Synchronous read for pointer handlers that must not depend on a render. */
export function isShiftHeld(): boolean {
  return held;
}

/** Re-renders the caller when Shift goes down or up. */
export function useShiftHeld(): boolean {
  const [value, setValue] = useState(held);
  useEffect(() => {
    startListening();
    subscribers.add(setValue);
    setValue(held);
    return () => {
      subscribers.delete(setValue);
    };
  }, []);
  return value;
}
