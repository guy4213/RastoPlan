import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import type { Action, AppState } from "./project.js";
import { initialAppState, initialProject, reduce } from "./project.js";
import { IndexedDBProvider } from "../storage/IndexedDBProvider.js";

interface ProjectContextValue {
  state: AppState;
  dispatch: (action: Action) => void;
}

const Ctx = createContext<ProjectContextValue | null>(null);

const PROJECT_ID = "primary";
const storage = new IndexedDBProvider();

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, undefined, () =>
    initialAppState(initialProject(PROJECT_ID))
  );

  // Load once on mount.
  const didLoad = useRef(false);
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void storage.load(PROJECT_ID).then(
      (project) => dispatch({ type: "load-project", project }),
      // Fresh install: no existing project, keep the seeded one.
      () => undefined
    );
  }, []);

  // Debounced auto-save on every project change.
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void storage.save(state.project).catch(() => undefined);
    }, 300);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [state.project]);

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useProject must be used inside <ProjectProvider>");
  return value;
}
