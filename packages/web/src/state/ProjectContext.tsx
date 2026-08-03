import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Project, ProjectMeta } from "@rastoplan/core";
import type { Action, AppState } from "./project.js";
import { initialAppState, initialProject, reduce } from "./project.js";
import { IndexedDBProvider } from "../storage/IndexedDBProvider.js";
import { useToast } from "../ui/Toast.js";

interface ProjectContextValue {
  state: AppState;
  dispatch: (action: Action) => void;
}

interface ProjectManagerValue {
  /** ID of the project currently loaded in the reducer. */
  currentId: string;
  list: () => Promise<ProjectMeta[]>;
  open: (id: string) => Promise<void>;
  create: (name: string) => Promise<Project>;
  duplicate: (id: string, name: string) => Promise<Project>;
  remove: (id: string) => Promise<void>;
}

const Ctx = createContext<ProjectContextValue | null>(null);
const ManagerCtx = createContext<ProjectManagerValue | null>(null);

const storage = new IndexedDBProvider();

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

/**
 * Pick the project to load on startup: the most recently updated one wins,
 * falling back to a freshly seeded project on empty storage. The old
 * hard-coded "primary" id trapped every install in a single project.
 */
async function pickInitialProject(): Promise<Project> {
  try {
    const rows = await storage.list();
    if (rows.length > 0) {
      const newest = [...rows].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]!;
      return await storage.load(newest.id);
    }
  } catch {
    // Fall through to seeded project; toast surfaces the real load errors
    // on user-triggered opens (see openProject).
  }
  const seeded = initialProject(uid("project"));
  try {
    await storage.save(seeded);
  } catch {
    // Storage might be unavailable (private-browsing quota, etc.) — keep
    // the in-memory project and let the auto-save toast surface it later.
  }
  return seeded;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  // Boot with a temporary seed so the reducer has something valid; the
  // useEffect below swaps it for the real pick from storage.
  const [state, dispatch] = useReducer(reduce, undefined, () =>
    initialAppState(initialProject(uid("project")))
  );
  const [ready, setReady] = useState(false);

  const didLoad = useRef(false);
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void pickInitialProject().then((project) => {
      dispatch({ type: "load-project", project });
      setReady(true);
    });
  }, []);

  // Debounced auto-save on every project change, but only after the initial
  // load — otherwise the seed project overwrites the real one before it
  // has a chance to load.
  const saveTimer = useRef<number | null>(null);
  const lastErrorAt = useRef(0);
  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void storage.save(state.project).catch((err: unknown) => {
        // Rate-limit the toast: a broken IndexedDB will fire on every keystroke.
        const now = Date.now();
        if (now - lastErrorAt.current < 5000) return;
        lastErrorAt.current = now;
        const message = err instanceof Error ? err.message : String(err);
        toast.push(`שמירה נכשלה — ${message}. שינויים לא נשמרו לדפדפן.`, "error");
      });
    }, 300);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [state.project, ready, toast]);

  const manager = useMemo<ProjectManagerValue>(() => {
    return {
      currentId: state.project.id,
      list: () => storage.list(),
      open: async (id: string) => {
        try {
          const project = await storage.load(id);
          dispatch({ type: "load-project", project });
          toast.push(`פרויקט "${project.name}" נטען.`, "success");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.push(`פתיחת פרויקט נכשלה — ${message}`, "error");
          throw err;
        }
      },
      create: async (name: string) => {
        const project: Project = { ...initialProject(uid("project")), name };
        try {
          await storage.save(project);
          dispatch({ type: "load-project", project });
          toast.push(`פרויקט "${name}" נוצר.`, "success");
          return project;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.push(`יצירת פרויקט נכשלה — ${message}`, "error");
          throw err;
        }
      },
      duplicate: async (id: string, name: string) => {
        try {
          const copy = await storage.duplicate(id, name);
          toast.push(`שכפול "${name}" הושלם.`, "success");
          return copy;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.push(`שכפול נכשל — ${message}`, "error");
          throw err;
        }
      },
      remove: async (id: string) => {
        try {
          await storage.remove(id);
          toast.push("הפרויקט נמחק.", "success");
          if (id === state.project.id) {
            // Removed the currently open project — pick the next best.
            const next = await pickInitialProject();
            dispatch({ type: "load-project", project: next });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.push(`מחיקה נכשלה — ${message}`, "error");
          throw err;
        }
      },
    };
  }, [state.project.id, toast]);

  const value = useMemo<ProjectContextValue>(() => ({ state, dispatch }), [state]);

  return (
    <Ctx.Provider value={value}>
      <ManagerCtx.Provider value={manager}>{children}</ManagerCtx.Provider>
    </Ctx.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useProject must be used inside <ProjectProvider>");
  return value;
}

export function useProjectManager(): ProjectManagerValue {
  const value = useContext(ManagerCtx);
  if (!value) throw new Error("useProjectManager must be used inside <ProjectProvider>");
  return value;
}

