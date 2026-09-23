import type {
  Pour,
  Project,
  ProjectLayout,
  Wall,
  Placement,
  Point,
  QuantityOverrides,
} from "@rastoplan/core";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_ACCESSORY_RULES,
  DEFAULT_PANEL_CATALOG,
  DEFAULT_POUR_THICKNESS_CM,
  ENGINE_VERSION,
  hasNonDefaultTimberGapBeforeMigration,
  migrateProject,
  previewPairingByWallId,
  retargetWallThickness,
  splitWallsAtJunctions,
  tileProject,
  withJunctionRestrictionFlag,
} from "@rastoplan/core";

export type Tool = "select" | "draw-wall" | "weld";

export type Units = "cm" | "m";

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
  /** Display units. Internal storage is always cm. */
  units: Units;
  /** Why the last edit was refused or adjusted; null when there is nothing to say. */
  notice: string | null;
  /**
   * Lock new wall lines to horizontal/vertical. A sticky mode rather than a
   * held modifier: drawing a run of orthogonal walls meant holding Shift for
   * the whole run, and letting go between segments silently produced a wall a
   * degree off. Affects drawing only — selection, pan and form fields ignore it.
   */
  orthoLock: boolean;
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

/**
 * The thickest a wall the numeric field and the drag handle will accept, in cm.
 *
 * Deliberately NOT handed to the engine as a pairing ceiling. It was, briefly,
 * to stop a half-finished drawing pairing a 400cm "wall" across a room — but
 * that ceiling then refused real plans: a room traced as two contours 165cm
 * apart came back unpaired, so both contours were tiled and the layout doubled,
 * which is the exact bug this whole phase exists to remove. A transient odd
 * number during an edit is recoverable; a doubled bill of materials is not.
 *
 * The engine therefore keeps its documented default of no ceiling, and the
 * preview and compute paths agree because neither passes one.
 */
export const MAX_WALL_THICKNESS_CM = 300;

/**
 * The thinnest a wall may be, in cm. Comfortably above the floor below which
 * the geometry engine cannot separate the two faces at all
 * (GEOMETRY_RESOLUTION_FLOOR_CM), so an accepted edit always resolves.
 */
export const MIN_WALL_THICKNESS_CM = 5;

export function initialProject(id: string): Project {
  const defaultPour: Pour = {
    id: uid("pour"),
    name: "יציקה 1",
    color: PALETTE[0]!,
    order: 0,
    defaultThicknessCm: DEFAULT_POUR_THICKNESS_CM,
  };
  return {
    id,
    name: "פרויקט חדש",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    // Catalog and rules are user-editable, so a project owns all nested
    // defaults rather than sharing the exported singleton objects.
    catalog: structuredClone(DEFAULT_PANEL_CATALOG),
    rules: structuredClone(DEFAULT_ACCESSORY_RULES),
    pours: [defaultPour],
    walls: [],
    placements: [],
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

export function initialAppState(project: Project): AppState {
  const opened = openProject(project);
  return {
    project: opened.project,
    ui: {
      tool: "select",
      activePourId: opened.project.pours[0]?.id ?? null,
      selectedWallId: null,
      selectedWallIds: [],
      selectedPlacementId: null,
      view: { scale: 0.5, offset: { x: 100, y: 100 } },
      layoutDirty: isLayoutMissing(opened.project),
      units: "cm",
      notice: opened.notice,
      // Off by default, so a fresh session draws exactly as it did before the
      // toggle existed — free angle unless the user asks for the lock.
      orthoLock: false,
    },
  };
}

/**
 * Flags a hand-edited panel the junction restriction forbids on its wall the
 * moment it is edited — not only at the next compute — using the end node
 * types the engine recorded on the layout. Without a layout the ends are
 * unknown and the flag is left for compute to decide.
 */
function withJunctionFlag(project: Project, placement: Placement): Placement {
  const endNodeTypes = project.layout?.resolvedWalls.find((w) => w.id === placement.wallId)?.endNodeTypes;
  return withJunctionRestrictionFlag(placement, project.catalog, endNodeTypes);
}

/**
 * A drawing with no current layout. Manual placements can outlive the layout
 * they were made in (an edit to another wall keeps them), so an empty placement
 * list is no longer the only sign that compute is due.
 */
function isLayoutMissing(project: Project): boolean {
  return project.walls.length > 0 && (project.placements.length === 0 || !project.layout);
}

export type Action =
  | { type: "load-project"; project: Project }
  | { type: "new-project"; project: Project }
  | { type: "rename-project"; name: string }
  | { type: "set-tool"; tool: Tool }
  | { type: "set-active-pour"; pourId: string | null }
  | { type: "select-wall"; wallId: string | null }
  | { type: "set-selected-walls"; wallIds: string[] }
  | { type: "select-placement"; placementId: string | null }
  | { type: "set-view"; view: UiState["view"] }
  | { type: "set-units"; units: Units }
  | { type: "set-ortho-lock"; value: boolean }
  | { type: "set-inventory"; inventory: Record<string, number> }
  | { type: "add-pour" }
  | { type: "update-pour"; pourId: string; patch: Partial<Pour> }
  | { type: "delete-pour"; pourId: string }
  | { type: "add-wall"; a: Point; b: Point }
  | { type: "update-wall"; wallId: string; patch: Partial<Wall> }
  | { type: "delete-wall"; wallId: string }
  | { type: "delete-walls"; wallIds: string[] }
  | { type: "weld-endpoints"; refs: { wallId: string; end: 0 | 1 }[]; at: Point }
  | { type: "compute" }
  | { type: "update-placement"; placementId: string; patch: Partial<Placement> }
  | { type: "delete-placement"; placementId: string }
  | { type: "insert-placement"; placement: Placement }
  | {
      type: "set-quantity-override";
      field: keyof QuantityOverrides;
      pourId: string;
      value: number | null;
    };

function withUpdatedAt(project: Project): Project {
  return { ...project, updatedAt: nowIso() };
}

/**
 * Drops everything the engine derived. Any edit to the walls invalidates the
 * whole resolution — which contour is wall material, which way is out — not
 * just the placements, so the two are always cleared together.
 */
function withClearedLayout(project: Project): Project {
  return { ...project, placements: [], layout: undefined };
}

export interface InvalidatedLayout {
  project: Project;
  /** Hebrew notice naming what was removed, or null when every manual item survived */
  notice: string | null;
}

/**
 * withClearedLayout for an edit that may leave hand-edited placements valid.
 *
 * Automatic placements and the layout are always dropped. A manual placement
 * survives only while the wall it sits on is untouched: both of its drawn
 * contours still exist with the same line, thickness and pour. A wall that
 * moved, changed length or thickness, was split, re-poured or deleted loses its
 * manual items, and the notice says which walls — approved rule: a manual edit
 * may be dropped with the geometry it was made for, but never silently.
 */
export function withLayoutInvalidated(before: Project, after: Project): InvalidatedLayout {
  const manual = before.placements.filter((p) => p.source === "manual");
  if (manual.length === 0) return { project: withClearedLayout(after), notice: null };

  const beforeById = new Map(before.walls.map((w) => [w.id, w]));
  const afterById = new Map(after.walls.map((w) => [w.id, w]));
  const sameWall = (id: string): boolean => {
    const a = beforeById.get(id);
    const b = afterById.get(id);
    return (
      !!a &&
      !!b &&
      a.pourId === b.pourId &&
      a.thickness === b.thickness &&
      a.innerLine[0].x === b.innerLine[0].x &&
      a.innerLine[0].y === b.innerLine[0].y &&
      a.innerLine[1].x === b.innerLine[1].x &&
      a.innerLine[1].y === b.innerLine[1].y
    );
  };
  const contoursOf = (wallId: string): string[] => {
    const resolved = before.layout?.resolvedWalls.find((w) => w.id === wallId);
    const partner = beforeById.get(wallId)?.pairedWallId;
    return [wallId, ...(resolved?.consumedWallIds ?? []), ...(partner ? [partner] : [])];
  };

  const kept: Placement[] = [];
  const droppedWallIds = new Set<string>();
  for (const placement of manual) {
    if (contoursOf(placement.wallId).every(sameWall)) kept.push(placement);
    else droppedWallIds.add(placement.wallId);
  }

  const project = { ...after, placements: kept, layout: undefined };
  if (droppedWallIds.size === 0) return { project, notice: null };
  const lengths = [...droppedWallIds].map((id) => {
    const wall = beforeById.get(id);
    return wall
      ? `${Math.round(Math.hypot(wall.innerLine[1].x - wall.innerLine[0].x, wall.innerLine[1].y - wall.innerLine[0].y))} ס"מ`
      : "קיר שנמחק";
  });
  const count = manual.length - kept.length;
  return {
    project,
    notice: `${count} פריטים שנערכו ידנית הוסרו כי הקיר שלהם השתנה (קירות: ${lengths.join(", ")})`,
  };
}

/**
 * The walls that carry hand-edited placements, for the warning shown before a
 * recompute. Returned as display lengths so the message can name them.
 */
export function manualPlacementWalls(project: Project): { wallIds: string[]; count: number; message: string | null } {
  const manual = project.placements.filter((p) => p.source === "manual");
  const wallIds = [...new Set(manual.map((p) => p.wallId))];
  if (wallIds.length === 0) return { wallIds, count: 0, message: null };
  const lengths = wallIds.map((id) => {
    const wall = project.walls.find((w) => w.id === id);
    return wall
      ? `${Math.round(Math.hypot(wall.innerLine[1].x - wall.innerLine[0].x, wall.innerLine[1].y - wall.innerLine[0].y))} ס"מ`
      : id;
  });
  return {
    wallIds,
    count: manual.length,
    message:
      `בפרויקט ${manual.length} פריטים שנערכו ידנית, על ${wallIds.length} קירות (${lengths.join(", ")}).\n` +
      "הם יישארו במקומם, והחישוב ימלא סביבם. פאנלי פינה שנערכו ידנית יחושבו מחדש.\n" +
      "להמשיך בחישוב?",
  };
}

/**
 * Repairs projects saved by the first inventory implementation, which copied
 * a blank/zero Excel cell into `Panel.inStock` and persisted most of the
 * catalog as false. The finite inventory is now authoritative; every catalog
 * row represented in that file must stay eligible so the engine can draw a
 * missing unit in red, and a later positive import can immediately use it.
 */
function withInventoryEligibleCatalog(project: Project): Project {
  if (!project.inventory) return project;
  const panels = project.catalog.panels.map((panel) =>
    Object.prototype.hasOwnProperty.call(project.inventory, panel.bomLabel) && !panel.inStock
      ? { ...panel, inStock: true }
      : panel
  );
  return panels.some((panel, index) => panel !== project.catalog.panels[index])
    ? { ...project, catalog: { ...project.catalog, panels } }
    : project;
}

/**
 * Re-derives, from the drawing alone, which walls are the two contours of one
 * wall and how far apart they are.
 *
 * Runs after every geometry change, which makes the thickness readable,
 * editable and saved as soon as a wrapping segment can be measured — no
 * compute required. It
 * calls only the geometry half of the engine (graph, faces, regions, pairing);
 * tiling and the bill of materials stay behind the compute button.
 *
 * It also replaces the older "just forget the pairing" step. Forgetting was
 * necessary because a link that outlives the geometry it was measured from
 * would move a wall that is no longer the far face; re-deriving gives that
 * guarantee too, and leaves a usable answer instead of a hole.
 */
function withDerivedPairing(project: Project): Project {
  const pairing = previewPairingByWallId(project.walls);

  const walls = project.walls.map((wall) => {
    const preview = pairing.get(wall.id);
    const partnerId = preview?.partnerId;
    if (!partnerId) return unpaired(wall);

    // The distance between these two matching drawn faces is the physical wall
    // thickness. Keep it on both source lines immediately, including while the
    // wrapping contour is still open, so canvas and persistence cannot diverge.
    const thickness = preview.thicknessCm;
    const samePartner = wall.pairedWallId === partnerId;
    const sameThickness = Math.abs(wall.thickness - thickness) <= THICKNESS_SYNC_EPSILON_CM;
    if (samePartner && sameThickness && wall.thicknessSet !== false) return wall;
    return { ...wall, pairedWallId: partnerId, thickness, thicknessSet: true };
  });

  const changed = walls.some((wall, i) => wall !== project.walls[i]);
  return changed ? { ...project, walls } : project;
}

/**
 * Final safety reconciliation against the computed layout. Normally the live
 * closed-contour pairing has already stored these exact values; keeping this
 * pass makes imported/legacy projects converge to the same source of truth at
 * compute time too.
 */
function withMeasuredThickness(project: Project, layout: ProjectLayout): Project {
  const measured = new Map<string, number>();
  for (const resolved of layout.resolvedWalls) {
    if (resolved.thicknessSource !== "measured") continue;
    const partnerId = resolved.consumedWallIds[0];
    if (!partnerId) continue;
    measured.set(resolved.sourceWallId, resolved.thickness);
    measured.set(partnerId, resolved.thickness);
  }

  return {
    ...project,
    walls: project.walls.map((wall) => {
      const thickness = measured.get(wall.id);
      if (thickness === undefined) return wall;
      if (
        Math.abs(wall.thickness - thickness) <= THICKNESS_SYNC_EPSILON_CM &&
        wall.thicknessSet !== false
      )
        return wall;
      return { ...wall, thickness, thicknessSet: true };
    }),
  };
}

/**
 * Replaces wall thicknesses that fall outside what the thickness field itself
 * accepts (5–300cm).
 *
 * A value below MIN, above MAX or non-numeric cannot have been typed — the
 * field refuses it. Legitimate heavy walls up to 300cm are preserved; only
 * values the editor and drag handle cannot represent are repaired.
 *
 * Healed on load only, and reported, so it is a one-time repair the user can
 * see rather than a silent rewrite while they work.
 */
/**
 * Everything that happens when a project blob enters the app, in one place.
 *
 * The engine check is the important half. Placements are STORED with the
 * project, so after an engine change the canvas would otherwise keep showing
 * formwork laid out under rules that no longer exist — corners butted flush
 * weeks after the engine started lapping them — and no engine fix can reach a
 * drawing that is data. A layout stamped by a different ENGINE_VERSION is
 * dropped here, at the choke point, so the only layouts ever rendered are ones
 * the current engine produced; the banner then asks for one recompute.
 */
function openProject(raw: Project): { project: Project; notice: string | null } {
  // Checked on the RAW blob, before migrateProject touches it — this is
  // exactly the "a project already has a non-default gap" case that
  // migration itself declines to overwrite (see the function's doc comment).
  const customTimberGap = hasNonDefaultTimberGapBeforeMigration(raw);
  const migrated = migrateProject(raw);
  const planarized = splitWallsAtJunctions(migrated.walls);
  const normalized = planarized.changed ? { ...migrated, walls: planarized.walls } : migrated;

  const stale = !!normalized.layout && normalized.layout.engineVersion !== ENGINE_VERSION;
  // A saved endpoint-on-segment junction used to look connected on screen but
  // was not a graph node. Its old placements cannot survive the conversion to
  // real T segments.
  const current = stale || planarized.changed ? withClearedLayout(normalized) : normalized;

  const { project: healedProject } = withHealedThickness(current);
  const project = withInventoryEligibleCatalog(withDerivedPairing(healedProject));

  const notice =
    stale
        ? "הפריסה חושבה בגרסה קודמת של מנוע החישוב ולכן נוקתה — יש ללחוץ חשב"
        : planarized.changed
          ? "חיבורי הקירות עודכנו לצמתי T אמיתיים — יש ללחוץ חשב"
          : customTimberGap
            ? 'בפרויקט זה טווח מרווח עץ מותאם אישית (שונה מ-5–9 הישן) — לא עודכן אוטומטית ל-1–5 ס"מ'
            : null;

  return { project, notice };
}

function withHealedThickness(project: Project): { project: Project; healed: number } {
  let healed = 0;
  const walls = project.walls.map((wall) => {
    const valid =
      Number.isFinite(wall.thickness) &&
      wall.thickness >= MIN_WALL_THICKNESS_CM &&
      wall.thickness <= MAX_WALL_THICKNESS_CM;
    if (valid && wall.thicknessSet !== false) return wall;

    healed++;
    return {
      ...wall,
      thickness: DEFAULT_POUR_THICKNESS_CM,
      thicknessSet: true,
    };
  });

  return { project: healed > 0 ? { ...project, walls } : project, healed };
}

function unpaired(wall: Wall): Wall {
  if (!wall.pairedWallId) return wall;
  const rest = { ...wall };
  delete rest.pairedWallId;
  return rest;
}

/**
 * Below this a re-measurement is float noise, not a change worth writing. It is
 * what makes computing twice over an unchanged drawing a no-op.
 */
const THICKNESS_SYNC_EPSILON_CM = 0.05;

/**
 * The opposite-face mate of a placement — the one produced by
 * syncFacePlacements when the layout was computed. Match on same edge,
 * same type/width/offset, opposite face, and matching kind, excluding
 * the corner overlap markers (they have no mate by design).
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
    case "new-project":
      // New projects reset the editing session; opening an existing project
      // deliberately retains its UI preferences through load-project.
      return initialAppState(action.project);

    case "load-project": {
      const opened = openProject(action.project);
      return {
        project: opened.project,
        ui: {
          ...state.ui,
          activePourId: opened.project.pours[0]?.id ?? null,
          selectedWallId: null,
          selectedWallIds: [],
          selectedPlacementId: null,
          // Off the OPENED project, not the raw blob: a layout the engine
          // check just dropped must light the banner, and the raw blob still
          // carries the placements that were dropped with it.
          layoutDirty: isLayoutMissing(opened.project),
          notice: opened.notice,
        },
      };
    }

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
    case "set-units":
      return { ...state, ui: { ...state.ui, units: action.units } };
    case "set-ortho-lock":
      return { ...state, ui: { ...state.ui, orthoLock: action.value } };
    case "set-inventory": {
      const inventory = Object.fromEntries(
        Object.entries(action.inventory).map(([label, value]) => [
          label,
          Number.isFinite(value) && value > 0 ? Math.floor(value) : 0,
        ])
      );
      // Stock does not move a wall, so hand-edited placements all survive; the
      // next compute re-checks them against the new quantities.
      const invalidated = withLayoutInvalidated(state.project, { ...state.project, inventory });
      return {
        ...state,
        project: withUpdatedAt(withInventoryEligibleCatalog(invalidated.project)),
        ui: { ...state.ui, layoutDirty: state.project.walls.length > 0, notice: invalidated.notice },
      };
    }

    case "add-pour": {
      const order = state.project.pours.length;
      const pour: Pour = {
        id: uid("pour"),
        name: `יציקה ${order + 1}`,
        color: PALETTE[order % PALETTE.length]!,
        order,
        defaultThicknessCm: DEFAULT_POUR_THICKNESS_CM,
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
          pours: state.project.pours.map((p) =>
            p.id === action.pourId ? { ...p, ...action.patch } : p
          ),
        }),
      };
    case "delete-pour": {
      // Reassign orphaned walls to the first remaining pour (if any).
      const remaining = state.project.pours.filter((p) => p.id !== action.pourId);
      const fallbackPourId = remaining[0]?.id ?? "";
      const walls = state.project.walls.map((w) =>
        w.pourId === action.pourId ? { ...w, pourId: fallbackPourId } : w
      );
      // Reassigning a pour can break a pairing: two faces of one wall must
      // belong to the same pour, so the link is re-derived rather than kept.
      const invalidated = withLayoutInvalidated(
        state.project,
        withDerivedPairing({ ...state.project, pours: remaining, walls })
      );
      return {
        ...state,
        project: withUpdatedAt(invalidated.project),
        ui: {
          ...state.ui,
          activePourId:
            state.ui.activePourId === action.pourId ? fallbackPourId : state.ui.activePourId,
          layoutDirty: true,
          notice: invalidated.notice,
        },
      };
    }

    case "add-wall": {
      const pourId = state.ui.activePourId ?? state.project.pours[0]?.id ?? "";
      const wall: Wall = {
        id: uid("wall"),
        pourId,
        innerLine: [action.a, action.b],
        thickness: DEFAULT_POUR_THICKNESS_CM,
        thicknessSet: true,
      };
      const walls = splitWallsAtJunctions([...state.project.walls, wall]).walls;
      const invalidated = withLayoutInvalidated(
        state.project,
        withDerivedPairing({ ...state.project, walls })
      );
      return {
        ...state,
        project: withUpdatedAt(invalidated.project),
        ui: {
          ...state.ui,
          layoutDirty: true,
          selectedWallId: wall.id,
          selectedWallIds: [wall.id],
          notice: invalidated.notice,
        },
      };
    }
    case "update-wall": {
      const { thickness, ...rest } = action.patch;

      // A thickness edit is the one geometry change that keeps the pairing
      // true: retargetWallThickness moves the far contour to match and
      // re-mitres its corners, so both sides stay the two faces of one wall.
      // The last computed layout (still `state.project.layout` here, before
      // this edit's own clearing below) tells it which contour is outer, so
      // the drawn outer dimensions never move.
      let project = state.project;
      let notice: string | null = null;

      if (thickness !== undefined) {
        const edited = project.walls.find((wall) => wall.id === action.wallId);
        const definedIds = new Set(
          [action.wallId, edited?.pairedWallId].filter((id): id is string => !!id)
        );
        const result = retargetWallThickness(
          project.walls,
          action.wallId,
          thickness,
          state.project.layout?.resolvedWalls
        );
        if (!result.applied) {
          return {
            ...state,
            ui: { ...state.ui, notice: result.diagnostics[0]?.message ?? null },
          };
        }
        project = {
          ...project,
          walls: result.walls.map((wall) =>
            definedIds.has(wall.id) ? { ...wall, thicknessSet: true } : wall
          ),
        };
        notice = result.diagnostics[0]?.message ?? null;
      }

      if (Object.keys(rest).length > 0) {
        const updatedWalls = project.walls.map((w) =>
          w.id === action.wallId ? { ...w, ...rest } : w
        );
        project = {
          ...project,
          walls: rest.innerLine ? splitWallsAtJunctions(updatedWalls).walls : updatedWalls,
        };
      }
      const invalidated = withLayoutInvalidated(state.project, withDerivedPairing(project));
      return {
        ...state,
        project: withUpdatedAt(invalidated.project),
        ui: { ...state.ui, layoutDirty: true, notice: invalidated.notice ?? notice },
      };
    }
    case "delete-wall":
    case "delete-walls": {
      const remove = new Set(action.type === "delete-wall" ? [action.wallId] : action.wallIds);
      const resetThicknessIds = new Set(
        state.project.walls
          .filter(
            (wall) => remove.has(wall.id) && wall.pairedWallId && !remove.has(wall.pairedWallId)
          )
          .map((wall) => wall.pairedWallId!)
      );
      // Clear the survivor's link here rather than waiting for the next
      // compute. The measured gap belonged to both drawn faces; if one is
      // deleted, the survivor returns to the 20cm wall default.
      const survivingWalls = state.project.walls
        .filter((wall) => !remove.has(wall.id))
        .map((wall) =>
          resetThicknessIds.has(wall.id)
            ? {
                ...unpaired(wall),
                thickness: DEFAULT_POUR_THICKNESS_CM,
                thicknessSet: true,
              }
            : wall
        );
      const invalidated = withLayoutInvalidated(
        state.project,
        withDerivedPairing({ ...state.project, walls: survivingWalls })
      );
      return {
        ...state,
        project: withUpdatedAt(invalidated.project),
        // Deletion cancels the current calculation. The dirty marker only asks
        // the user to press "compute"; ProjectContext never computes by itself.
        ui: {
          ...state.ui,
          layoutDirty: survivingWalls.length > 0,
          selectedWallId: null,
          selectedWallIds: [],
          notice: invalidated.notice,
        },
      };
    }
    case "weld-endpoints": {
      // Move every listed endpoint to the same exact coordinate — the
      // result is guaranteed to be a shared vertex (not "close enough")
      // so downstream corner detection can't miss it.
      const at = { x: Math.round(action.at.x), y: Math.round(action.at.y) };
      const byWall = new Map<string, (0 | 1)[]>();
      for (const r of action.refs) {
        const list = byWall.get(r.wallId) ?? [];
        list.push(r.end);
        byWall.set(r.wallId, list);
      }
      const walls = state.project.walls.map((w) => {
        const ends = byWall.get(w.id);
        if (!ends) return w;
        const line: [Point, Point] = [w.innerLine[0], w.innerLine[1]];
        if (ends.includes(0)) line[0] = at;
        if (ends.includes(1)) line[1] = at;
        return { ...w, innerLine: line };
      });
      const planarWalls = splitWallsAtJunctions(walls).walls;
      const invalidated = withLayoutInvalidated(
        state.project,
        withDerivedPairing({ ...state.project, walls: planarWalls })
      );
      return {
        ...state,
        project: withUpdatedAt(invalidated.project),
        ui: { ...state.ui, layoutDirty: true, notice: invalidated.notice },
      };
    }

    case "compute": {
      // Projects already open during a hot update can still carry the old
      // `thicknessSet: false` marker. Apply the 20cm default here as well as
      // on load, so the legacy flag can never block calculation.
      const project = withHealedThickness(state.project).project;
      // Hand-edited placements ride along in `project.placements`; the engine
      // keeps the ones whose wall still resolves and tiles around them.
      const { placements, layout } = tileProject(project);
      const dropped = layout.diagnostics.some((d) => d.code === "manual-placement-dropped");
      return {
        ...state,
        project: withUpdatedAt({
          ...withMeasuredThickness(project, layout),
          placements,
          layout,
        }),
        ui: {
          ...state.ui,
          layoutDirty: false,
          notice: dropped ? "חלק מהפריטים שנערכו ידנית לא נשמרו בחישוב — ראו הערות המנוע" : null,
        },
      };
    }

    case "set-quantity-override": {
      const field = state.project.overrides?.[action.field] ?? {};
      return {
        ...state,
        // Deliberately does NOT clear the layout: a hand-typed quantity has to
        // survive every recompute, which is the whole point of it.
        project: withUpdatedAt({
          ...state.project,
          overrides: {
            ...state.project.overrides,
            [action.field]: { ...field, [action.pourId]: action.value },
          },
        }),
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
      if (action.patch.offsetAlongEdge !== undefined)
        twinPatch.offsetAlongEdge = action.patch.offsetAlongEdge;
      if (action.patch.width !== undefined) twinPatch.width = action.patch.width;
      if (action.patch.panelType !== undefined) twinPatch.panelType = action.patch.panelType;
      if (action.patch.kind !== undefined) twinPatch.kind = action.patch.kind;

      return {
        ...state,
        project: withUpdatedAt({
          ...state.project,
          placements: state.project.placements.map((p) => {
            if (p.id === target.id) return withJunctionFlag(state.project, { ...p, ...patch });
            if (twin && p.id === twin.id) return withJunctionFlag(state.project, { ...p, ...twinPatch });
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
          placements: [
            ...state.project.placements,
            withJunctionFlag(state.project, { ...action.placement, source: "manual" }),
          ],
        }),
      };

    default:
      return state;
  }
}
