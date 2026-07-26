import type { Pour, Project, Wall, Placement, Point } from "@rastoplan/core";
import { DEFAULT_ACCESSORY_RULES, DEFAULT_PANEL_CATALOG, tileProject } from "@rastoplan/core";

export type Tool = "select" | "draw-wall";

export interface UiState {
  tool: Tool;
  activePourId: string | null;
  selectedWallId: string | null;
  /**
   * Full marquee/multi selection. selectedWallId is the "primary" (the one
   * whose props show in the WallPanel) and is always the first entry here
   * when non-null.
   */
  selectedWallIds: string[];
  selectedPlacementId: string | null;
  /** Canvas view transform: scale (px per cm) and pan offset (in px). */
  view: { scale: number; offset: Point };
  /** Set when the computed layout is out-of-date relative to walls/pours. */
  layoutDirty: boolean;
}

export interface AppState {
  project: Project;
  ui: UiState;
}

const PALETTE = ["#dc2626", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0891b2"];

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function initialProject(id: string): Project {
  const defaultPour: Pour = { id: uid("pour"), name: "יציקה 1", color: PALETTE[0]!, order: 0 };
  return {
    id,
    name: "פרויקט חדש",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    catalog: DEFAULT_PANEL_CATALOG,
    rules: DEFAULT_ACCESSORY_RULES,
    pours: [defaultPour],
    walls: [],
    placements: [],
  };
}

export function initialAppState(project: Project): AppState {
  return {
    project,
    ui: {
      tool: "select",
      activePourId: project.pours[0]?.id ?? null,
      selectedWallId: null,
      selectedWallIds: [],
      selectedPlacementId: null,
      view: { scale: 0.5, offset: { x: 100, y: 100 } },
      layoutDirty: false,
    },
  };
}

export type Action =
  | { type: "load-project"; project: Project }
  | { type: "rename-project"; name: string }
  | { type: "set-tool"; tool: Tool }
  | { type: "set-active-pour"; pourId: string | null }
  | { type: "select-wall"; wallId: string | null }
  | { type: "set-selected-walls"; wallIds: string[] }
  | { type: "select-placement"; placementId: string | null }
  | { type: "set-view"; view: UiState["view"] }
  | { type: "add-pour" }
  | { type: "update-pour"; pourId: string; patch: Partial<Pour> }
  | { type: "delete-pour"; pourId: string }
  | { type: "add-wall"; a: Point; b: Point }
  | { type: "update-wall"; wallId: string; patch: Partial<Wall> }
  | { type: "delete-wall"; wallId: string }
  | { type: "delete-walls"; wallIds: string[] }
  | { type: "compute" }
  | { type: "update-placement"; placementId: string; patch: Partial<Placement> }
  | { type: "delete-placement"; placementId: string }
  | { type: "insert-placement"; placement: Placement };

function withUpdatedAt(project: Project): Project {
  return { ...project, updatedAt: nowIso() };
}

/**
 * The outer-face mate of a placement — the one produced by
 * syncOuterPlacements when the layout was computed. Match on same edge,
 * same type/width/offset, opposite side, and matching kind, excluding
 * outer-only protrusion markers (they have no inner twin by design).
 */
function findSyncTwin(target: Placement, all: Placement[]): Placement | undefined {
  if (target.flags.includes("outer-corner-protrusion")) return undefined;
  return all.find(
    (p) =>
      p.id !== target.id &&
      p.edgeId === target.edgeId &&
      p.side !== target.side &&
      p.kind === target.kind &&
      p.panelType === target.panelType &&
      p.width === target.width &&
      p.offsetAlongEdge === target.offsetAlongEdge &&
      !p.flags.includes("outer-corner-protrusion")
  );
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "load-project":
      return {
        project: action.project,
        ui: {
          ...state.ui,
          activePourId: action.project.pours[0]?.id ?? null,
          selectedWallId: null,
          selectedWallIds: [],
          selectedPlacementId: null,
          layoutDirty: action.project.placements.length === 0 && action.project.walls.length > 0,
        },
      };

    case "rename-project":
      return { ...state, project: withUpdatedAt({ ...state.project, name: action.name }) };

    case "set-tool":
      return { ...state, ui: { ...state.ui, tool: action.tool } };
    case "set-active-pour":
      return { ...state, ui: { ...state.ui, activePourId: action.pourId } };
    case "select-wall":
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedWallId: action.wallId,
          selectedWallIds: action.wallId ? [action.wallId] : [],
          selectedPlacementId: null,
        },
      };
    case "set-selected-walls":
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedWallIds: action.wallIds,
          selectedWallId: action.wallIds[0] ?? null,
          selectedPlacementId: null,
        },
      };
    case "select-placement":
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedPlacementId: action.placementId,
          selectedWallId: null,
          selectedWallIds: [],
        },
      };
    case "set-view":
      return { ...state, ui: { ...state.ui, view: action.view } };

    case "add-pour": {
      const order = state.project.pours.length;
      const pour: Pour = {
        id: uid("pour"),
        name: `יציקה ${order + 1}`,
        color: PALETTE[order % PALETTE.length]!,
        order,
      };
      return {
        ...state,
        project: withUpdatedAt({ ...state.project, pours: [...state.project.pours, pour] }),
        ui: { ...state.ui, activePourId: pour.id },
      };
    }
    case "update-pour":
      return {
        ...state,
        project: withUpdatedAt({
          ...state.project,
          pours: state.project.pours.map((p) => (p.id === action.pourId ? { ...p, ...action.patch } : p)),
        }),
      };
    case "delete-pour": {
      // Reassign orphaned walls to the first remaining pour (if any).
      const remaining = state.project.pours.filter((p) => p.id !== action.pourId);
      const fallbackPourId = remaining[0]?.id ?? "";
      const walls = state.project.walls.map((w) =>
        w.pourId === action.pourId ? { ...w, pourId: fallbackPourId } : w
      );
      return {
        ...state,
        project: withUpdatedAt({
          ...state.project,
          pours: remaining,
          walls,
          placements: [],
        }),
        ui: {
          ...state.ui,
          activePourId: state.ui.activePourId === action.pourId ? fallbackPourId : state.ui.activePourId,
          layoutDirty: true,
        },
      };
    }

    case "add-wall": {
      const pourId = state.ui.activePourId ?? state.project.pours[0]?.id ?? "";
      const wall: Wall = {
        id: uid("wall"),
        pourId,
        innerLine: [action.a, action.b],
        thickness: 20,
      };
      return {
        ...state,
        project: withUpdatedAt({ ...state.project, walls: [...state.project.walls, wall], placements: [] }),
        ui: { ...state.ui, layoutDirty: true, selectedWallId: wall.id, selectedWallIds: [wall.id] },
      };
    }
    case "update-wall": {
      return {
        ...state,
        project: withUpdatedAt({
          ...state.project,
          walls: state.project.walls.map((w) =>
            w.id === action.wallId ? { ...w, ...action.patch } : w
          ),
          placements: [],
        }),
        ui: { ...state.ui, layoutDirty: true },
      };
    }
    case "delete-wall":
      return {
        ...state,
        project: withUpdatedAt({
          ...state.project,
          walls: state.project.walls.filter((w) => w.id !== action.wallId),
          placements: [],
        }),
        ui: { ...state.ui, layoutDirty: true, selectedWallId: null, selectedWallIds: [] },
      };
    case "delete-walls": {
      const remove = new Set(action.wallIds);
      return {
        ...state,
        project: withUpdatedAt({
          ...state.project,
          walls: state.project.walls.filter((w) => !remove.has(w.id)),
          placements: [],
        }),
        ui: { ...state.ui, layoutDirty: true, selectedWallId: null, selectedWallIds: [] },
      };
    }

    case "compute": {
      const placements = tileProject(state.project);
      return {
        ...state,
        project: withUpdatedAt({ ...state.project, placements }),
        ui: { ...state.ui, layoutDirty: false },
      };
    }

    case "update-placement": {
      const target = state.project.placements.find((p) => p.id === action.placementId);
      if (!target) return state;
      const twin = findSyncTwin(target, state.project.placements);
      const patch = { ...action.patch, source: "manual" as const };
      // The twin inherits every geometric/type change (offset, width,
      // panelType, kind) but keeps its own side — that's exactly what
      // preserves Dywidag alignment across the wall.
      const twinPatch: Partial<Placement> = { source: "manual" };
      if (action.patch.offsetAlongEdge !== undefined) twinPatch.offsetAlongEdge = action.patch.offsetAlongEdge;
      if (action.patch.width !== undefined) twinPatch.width = action.patch.width;
      if (action.patch.panelType !== undefined) twinPatch.panelType = action.patch.panelType;
      if (action.patch.kind !== undefined) twinPatch.kind = action.patch.kind;

      return {
        ...state,
        project: withUpdatedAt({
          ...state.project,
          placements: state.project.placements.map((p) => {
            if (p.id === target.id) return { ...p, ...patch };
            if (twin && p.id === twin.id) return { ...p, ...twinPatch };
            return p;
          }),
        }),
      };
    }
    case "delete-placement": {
      const target = state.project.placements.find((p) => p.id === action.placementId);
      if (!target) return state;
      const twin = findSyncTwin(target, state.project.placements);
      const idsToRemove = new Set<string>([target.id]);
      // Sync preservation: dropping only one side would leave the other
      // face with an orphan seam that can't be tied through — delete both.
      if (twin) idsToRemove.add(twin.id);
      return {
        ...state,
        project: withUpdatedAt({
          ...state.project,
          placements: state.project.placements.filter((p) => !idsToRemove.has(p.id)),
        }),
        ui: { ...state.ui, selectedPlacementId: null },
      };
    }
    case "insert-placement":
      return {
        ...state,
        project: withUpdatedAt({
          ...state.project,
          placements: [...state.project.placements, { ...action.placement, source: "manual" }],
        }),
      };

    default:
      return state;
  }
}
