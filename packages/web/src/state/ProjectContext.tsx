import {
  createContext,
  useCallback,
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
import { storageProvider } from "../storage/index.js";
import { useToast } from "../ui/Toast.js";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface ProjectContextValue {
  state: AppState;
  dispatch: (action: Action) => void;
  saveStatus: SaveStatus;
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

const storage = storageProvider;

export const AUTO_COMPUTE_DELAY_MS = 300;

/** Shared by the provider effect and its fake-timer regression tests. */
export function scheduleAutoCompute(
  layoutDirty: boolean,
  dispatch: (action: Action) => void
): () => void {
  if (!layoutDirty) return () => undefined;
  const timer = globalThis.setTimeout(
    () => dispatch({ type: "compute" }),
    AUTO_COMPUTE_DELAY_MS
  );
  return () => globalThis.clearTimeout(timer);
}

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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // A manager transition can happen while the latest edit is still in the
  // debounce window. This ref always points at the project being left.
  const projectRef = useRef(state.project);
  projectRef.current = state.project;

  const didLoad = useRef(false);
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void pickInitialProject().then((project) => {
      dispatch({ type: "load-project", project });
      setReady(true);
    });
  }, []);

  // Geometry and inventory edits clear the stale layout and set layoutDirty.
  // Recompute after the edit burst, while manual placement/quantity edits stay
  // untouched because those actions deliberately leave layoutDirty false.
  useEffect(() => {
    if (!ready) return;
    return scheduleAutoCompute(state.ui.layoutDirty, dispatch);
  }, [ready, state.ui.layoutDirty, state.project.walls, state.project.inventory]);

  // Debounced auto-save on every project change, but only after the initial
  // load — otherwise the seed project overwrites the real one before it
  // has a chance to load.
  const saveTimer = useRef<number | null>(null);
  const saveRevision = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const lastErrorAt = useRef(0);

  const persistProject = useCallback(async (project: Project, revision: number) => {
    const request = saveQueue.current.catch(() => undefined).then(() => storage.save(project));
    saveQueue.current = request;

    try {
      await request;
      if (saveRevision.current === revision) setSaveStatus("saved");
    } catch (error) {
      if (saveRevision.current === revision) setSaveStatus("error");
      throw error;
    }
  }, []);

  const flushSave = useCallback(async (skipProjectId?: string) => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const project = projectRef.current;
    // Removing the open project deliberately discards it, so never recreate
    // it after storage.remove has run.
    if (project.id === skipProjectId) {
      saveRevision.current += 1;
      setSaveStatus("idle");
      await saveQueue.current.catch(() => undefined);
      return;
    }

    const revision = ++saveRevision.current;
    setSaveStatus("saving");
    await persistProject(project, revision);
  }, [persistProject]);

  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const revision = ++saveRevision.current;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      saveTimer.current = null;
      void persistProject(state.project, revision).catch((err: unknown) => {
        if (saveRevision.current !== revision) return;
        // Rate-limit the toast: a broken IndexedDB will fire on every keystroke.
        const now = Date.now();
        if (now - lastErrorAt.current < 5000) return;
        lastErrorAt.current = now;
        const message = err instanceof Error ? err.message : String(err);
        toast.push(`שמירה נכשלה — ${message}. שינויים לא נשמרו לדפדפן.`, "error");
      });
    }, 300);
    saveTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
    };
  }, [state.project, ready, toast, persistProject]);

  const manager = useMemo<ProjectManagerValue>(() => {
    return {
      currentId: state.project.id,
      list: () => storage.list(),
      open: async (id: string) => {
        try {
          await flushSave();
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
          await flushSave();
          const revision = ++saveRevision.current;
          setSaveStatus("saving");
          await persistProject(project, revision);
          dispatch({ type: "new-project", project });
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
          // The copy is made from what storage holds, so the open project's
          // pending edits have to land first — otherwise duplicating the
          // project you are looking at silently copies the previous version.
          await flushSave();
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
          await flushSave(id);
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
  }, [state.project.id, toast, flushSave, persistProject]);

  const value = useMemo<ProjectContextValue>(() => ({ state, dispatch, saveStatus }), [state, saveStatus]);

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

