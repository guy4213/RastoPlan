import type { Diagnostic, NodeType, Placement, Project, ProjectLayout, RegionSummary } from "../types.js";
import { resolveWalls } from "../contours/resolveWalls.js";
import type { ResolveOptions } from "../contours/constants.js";
import { tileWallPair } from "../tiling/tileWallPair.js";
import { blockedSpansFor, isPreservedManualPlacement } from "../tiling/manualPlacements.js";
import {
  JUNCTION_RESTRICTED_FLAG,
  restrictedPanelMayLandOffJunction,
  withJunctionRestrictionFlag,
} from "../tiling/junctionRestriction.js";
import { detectExternalCorners } from "../geometry/detectExternalCorners.js";
import { placeCornerPanels } from "./placeCornerPanels.js";
import type { FaceRun } from "./faceRuns.js";

/** Bump when a change makes previously saved layouts wrong rather than merely stale. */
/**
 * Stamped into every layout so a stored one can be told apart from what the
 * current engine would produce. Bump it whenever a change makes old layouts
 * wrong rather than merely different — the web app drops mismatched layouts on
 * load and asks for a recompute.
 *
 * 3: thin walls pair (the 15cm floor became technical), thickness is measured
 *    off the drawing, and outer corners are lapped joints instead of butted.
 * 4: the lap direction was finalised: horizontal panels carry the full 10cm;
 *    vertical panels are inset 2cm at the top and bottom. Version 3 existed
 *    while that corner rule was still being tuned, so its stored placements
 *    must not survive and keep showing a square 10x10 overlap.
 * 5: corner-lap centimetres moved out of tileable run lengths and into the
 *    canvas-only drawing copies. Version 4 can contain artificial 8cm timber
 *    fillers and wrong accessory counts, so every such layout is recomputed.
 * 6: imported finite inventory now constrains corner and straight-panel
 *    selection per pour. Version 5 layouts can contain panels unavailable in
 *    the project's saved inventory.
 * 7: partial inventory is placed unit-by-unit; only missing units are flagged
 *    instead of replacing an otherwise usable wall run with one red block.
 * 8: every resolved physical wall temporarily got only its primary row.
 * 9: clear outside K30 corners are derived from the current wall graph and
 *    stored in the layout instead of being seeded as fixture-only points.
 * 10: every DRAWN face gets exactly one row. A paired second contour is tiled;
 *     an undrawn face derived only from a thickness value is not.
 * 11: outside K30 corners follow the drawn exterior face of a paired wall,
 *     rather than the primary inner contour retained for tiling bookkeeping.
 * 12: both faces of a wall are tiled as one unit. The stretch they share is
 *     planned once and placed at identical offsets on each face, so their
 *     joints line up across the wall's thickness; only what a face holds
 *     beyond that stretch is chosen for it alone. Versions up to 11 tiled each
 *     face independently, which the customer's reference drawing shows to be
 *     wrong in every wall, so those layouts must not survive.
 * 13: re-entrant corners on a drawn exterior contour receive their required
 *     C30x30 panel. Version 12 can retain untileable 10cm end remnants there.
 * 14: junction-restricted panels. R90 is selectable only on a wall segment
 *     with a T junction at one of its ends (customer decision). Version 13 used
 *     R90 anywhere, so its layouts carry panels the rule now forbids.
 * 15: timber-gap range narrowed from 5–9cm to 1–5cm (customer decision,
 *     13/9/2026). Version 14 could both fill gaps 1–4cm as gap-out-of-range
 *     when they are now legal, and select combinations landing on a 6–9cm gap
 *     that is no longer allowed.
 */
export const ENGINE_VERSION = 15;

export interface TileProjectResult {
  placements: Placement[];
  layout: ProjectLayout;
}

/**
 * Runs the full contours+corners+tiling pipeline and returns the complete
 * placement set plus the derived layout.
 *
 * Pipeline:
 *   1. resolveWalls: face traversal → regions → contour pairing. Decides what
 *      is a room, what is wall material, which way is out, and which drawn
 *      walls were only the far face of another wall.
 *   2. placeCornerPanels: a corner panel per room per corner, on the face that
 *      borders that room; overlap strips only on faces that border no room.
 *   3. Per resolved physical wall: tile every face that the user actually
 *      drew. A single line therefore gets one row; a paired inner+outer trace
 *      gets two rows total, one on each source line.
 *
 * Consumed walls are never tiled — that is what stops a plan traced as two
 * rectangles from producing two independent, doubled-up wall sets.
 */
export function tileProject(project: Project, options: ResolveOptions = {}): TileProjectResult {
  const { walls, catalog, rules } = project;

  const resolution = resolveWalls(walls, options);
  const availablePanelCountsByPour = inventoryLedger(project);
  const corners = placeCornerPanels({
    resolution,
    walls,
    catalog,
    rules,
    availablePanelCountsByPour,
  });

  const edgeById = new Map(corners.edges.map((e) => [e.id, e]));
  const placements: Placement[] = [];
  const diagnostics = [...resolution.diagnostics, ...corners.diagnostics];

  const endNodeTypesByWallId = wallEndNodeTypes(resolution);
  const manual = keptManualPlacements(
    project,
    resolution.resolvedWalls,
    edgeById,
    corners.runs,
    availablePanelCountsByPour,
    endNodeTypesByWallId
  );
  diagnostics.push(...manual.diagnostics);
  const manualIds = new Set(project.placements.filter((p) => p.source === "manual").map((p) => p.id));

  for (const resolvedWall of resolution.resolvedWalls) {
    const edge = edgeById.get(`edge:${resolvedWall.id}`);
    const runs = corners.runs.get(edge?.id ?? "");
    if (!edge || !runs) continue;
    const manualOnEdge = manual.byEdgeId.get(edge.id) ?? [];
    const endNodeTypes = endNodeTypesByWallId.get(resolvedWall.id) ?? [];

    // One panel row per DRAWN face. faceA is always the primary source line.
    // faceB is included only when it came from a real paired contour; an
    // unpaired wall's thickness-derived face must not manufacture another row.
    //
    // Both rows are produced by ONE call: where the faces overlap they must
    // carry the same panels at the same offsets, and that is guaranteed by
    // planning the shared stretch once rather than by tiling each face and
    // comparing afterwards.
    const drawnFaces = resolvedWall.faces.filter(
      (face) => face.id === "faceA" || face.sourceWallId !== undefined
    );
    const availability = availablePanelCountsByPour?.[resolvedWall.pourId];
    const tiled = tileWallPair({
      edge,
      wallId: resolvedWall.id,
      pourId: resolvedWall.pourId,
      faces: drawnFaces.map((face) => ({
        side: face.id,
        faceIsInterior: face.isInterior,
        clearLength: runs[face.id].clearLength,
        startOffset: runs[face.id].startOffset,
      })),
      catalog,
      rules,
      availability,
      endNodeTypes,
      ...(manualOnEdge.length > 0
        ? { blocked: blockedSpansFor(manualOnEdge), manualPlacements: manualOnEdge }
        : {}),
    });
    // A regenerated id must never shadow a hand-edited placement that kept its
    // old automatic id — selection and the face-twin sync both key on it.
    for (const p of tiled.placements) {
      while (manualIds.has(p.id)) p.id = `${p.id}:auto`;
    }
    diagnostics.push(...tiled.diagnostics);
    diagnostics.push(...offJunctionWarnings(tiled.placements, catalog, endNodeTypes, resolvedWall.id));
    consumeStraightPanels(tiled.placements, availability);
    const missing = missingPanelCounts([...manualOnEdge, ...tiled.placements]);
    if (Object.keys(missing).length > 0) {
      diagnostics.push({
        code: "inventory-straight-panel-shortage",
        severity: "error",
        message: `חסרים במלאי למקטע זה: ${Object.entries(missing)
          .map(([type, count]) => `${type} × ${count}`)
          .join(", ")}`,
        wallIds: [resolvedWall.id],
        nodeIds: [edge.nodeA, edge.nodeB],
      });
    }

    placements.push(
      ...corners.cornerPanels.filter((p) => p.edgeId === edge.id),
      ...manualOnEdge,
      ...tiled.placements,
      ...corners.protrusions.filter((p) => p.edgeId === edge.id)
    );
  }

  const activeEdges = corners.edges.filter((edge) => resolution.wallByEdgeId.has(edge.id));
  const exteriorSourceWallIds = new Set(
    resolution.resolvedWalls.map((resolvedWall) => {
      const drawnExteriorFace = resolvedWall.faces.find(
        (face) => !face.isInterior && face.sourceWallId !== undefined
      );
      return drawnExteriorFace?.sourceWallId ?? resolvedWall.sourceWallId;
    })
  );
  const exteriorEdges = corners.edges.filter((edge) =>
    exteriorSourceWallIds.has(edge.wallId)
  );
  const layout: ProjectLayout = {
    nodes: resolution.nodes,
    // Consumed edges are dropped: every accessory counter reads this list as
    // "walls that need formwork", and a wall that was only the far face of
    // another one would otherwise be counted a second time for struts.
    edges: activeEdges,
    resolvedWalls: resolution.resolvedWalls.map((resolvedWall) => ({
      ...resolvedWall,
      endNodeTypes: endNodeTypesByWallId.get(resolvedWall.id) ?? [],
    })),
    regions: resolution.regions.map((r): RegionSummary => ({
      id: r.id,
      kind: r.kind,
      area: r.area,
    })),
    corners: resolution.corners,
    externalCorners: detectExternalCorners(resolution.nodes, exteriorEdges, walls),
    diagnostics,
    engineVersion: ENGINE_VERSION,
  };

  return { placements, layout };
}

interface KeptManual {
  byEdgeId: Map<string, Placement[]>;
  diagnostics: Diagnostic[];
}

/**
 * The hand-edited placements that survive this compute, grouped by edge, with
 * their stock drawn from the pour's ledger BEFORE any automatic tiling.
 *
 * A manual placement is kept only when the wall it was placed on still
 * resolves to the same tiled edge in the same pour. Anything else — a wall that
 * was split, re-paired or reassigned, or a hand-swapped corner panel, which the
 * corners layer always re-derives — is dropped and reported per wall, so a
 * user-made change never disappears without a message.
 *
 * Mutates `availabilityByPour` on purpose: manual units are already on the
 * wall, so the automatic fill must only see what is left.
 */
function keptManualPlacements(
  project: Project,
  resolvedWalls: { id: string; pourId: string }[],
  edgeById: Map<string, { id: string }>,
  runs: Map<string, Record<Placement["side"], FaceRun>>,
  availabilityByPour: Record<string, Record<string, number>> | undefined,
  endNodeTypesByWallId: Map<string, NodeType[]>
): KeptManual {
  const byEdgeId = new Map<string, Placement[]>();
  const diagnostics: Diagnostic[] = [];
  const manual = project.placements.filter((p) => p.source === "manual");
  if (manual.length === 0) return { byEdgeId, diagnostics };

  const pourByEdgeId = new Map(
    resolvedWalls
      .filter((w) => edgeById.has(`edge:${w.id}`) && runs.has(`edge:${w.id}`))
      .map((w) => [`edge:${w.id}`, w.pourId])
  );

  const droppedByWall = new Map<string, number>();
  for (const placement of manual) {
    const pourId = pourByEdgeId.get(placement.edgeId);
    const faceRun = runs.get(placement.edgeId)?.[placement.side];
    const placementEnd = placement.offsetAlongEdge + placement.width;
    const insideRun =
      faceRun !== undefined &&
      Number.isFinite(placement.offsetAlongEdge) &&
      Number.isFinite(placement.width) &&
      placement.width > 0 &&
      Number.isInteger(placement.offsetAlongEdge) &&
      Number.isInteger(placement.width) &&
      placement.offsetAlongEdge >= faceRun.startOffset - 1e-6 &&
      placementEnd <= faceRun.startOffset + faceRun.clearLength + 1e-6;
    if (
      !isPreservedManualPlacement(placement) ||
      pourId === undefined ||
      pourId !== placement.pourId ||
      !insideRun
    ) {
      droppedByWall.set(placement.wallId, (droppedByWall.get(placement.wallId) ?? 0) + 1);
      continue;
    }

    // Engine flags on a hand-edited item are stale by now; only the stock
    // check below is re-derived for it.
    let flags: string[] = [];
    const ledger = availabilityByPour?.[pourId];
    if (ledger && placement.kind === "panel" && placement.panelType) {
      if ((ledger[placement.panelType] ?? 0) > 0) ledger[placement.panelType] = ledger[placement.panelType]! - 1;
      else flags = ["inventory-shortage"];
    }
    // Allowed but flagged (approved rule): a hand-placed panel the junction
    // restriction forbids here stays where the user put it and shows red.
    const kept = withJunctionRestrictionFlag(
      { ...placement, flags },
      project.catalog,
      endNodeTypesByWallId.get(placement.wallId) ?? []
    );
    if (kept.flags.includes(JUNCTION_RESTRICTED_FLAG)) {
      diagnostics.push({
        code: "manual-panel-junction-restricted",
        severity: "warning",
        message: `${placement.panelType} הוצב ידנית בקיר שאינו בצומת מותרת — הכלל מתיר אותו רק בצומת T`,
        wallIds: [placement.wallId],
        nodeIds: [],
      });
    }
    const list = byEdgeId.get(placement.edgeId) ?? [];
    list.push(kept);
    byEdgeId.set(placement.edgeId, list);
  }

  for (const [wallId, count] of droppedByWall) {
    diagnostics.push({
      code: "manual-placement-dropped",
      severity: "warning",
      message: `${count} פריטים שנערכו ידנית לא נשמרו בקיר זה — הקיר השתנה, המיקום יצא מטווח הקיר או שמדובר בפאנל פינה, והם חושבו מחדש`,
      wallIds: [wallId],
      nodeIds: [],
    });
  }
  return { byEdgeId, diagnostics };
}

/**
 * Node types at the ends of every drawn contour of each resolved wall, keyed by
 * resolved wall id. Both contours of a paired wall count: on a plan traced as
 * two contours a T junction may sit on either line, and the wall is at that T
 * either way.
 */
function wallEndNodeTypes(resolution: ReturnType<typeof resolveWalls>): Map<string, NodeType[]> {
  const nodeTypeById = new Map(resolution.nodes.map((node) => [node.id, node.type]));
  const edgeByWallId = new Map(resolution.edges.map((edge) => [edge.wallId, edge]));
  const byWallId = new Map<string, NodeType[]>();
  for (const resolvedWall of resolution.resolvedWalls) {
    const types = new Set<NodeType>();
    for (const wallId of [resolvedWall.sourceWallId, ...resolvedWall.consumedWallIds]) {
      const edge = edgeByWallId.get(wallId);
      if (!edge) continue;
      for (const nodeId of [edge.nodeA, edge.nodeB]) {
        const type = nodeTypeById.get(nodeId);
        if (type) types.add(type);
      }
    }
    byWallId.set(resolvedWall.id, [...types].sort());
  }
  return byWallId;
}

/**
 * One warning per wall where the engine chose a junction-restricted panel on a
 * segment that qualifies at one end only (e.g. T at one end, L at the other).
 * Approved: allowed — the middle rule decides where it lands — but reported.
 */
function offJunctionWarnings(
  placements: Placement[],
  catalog: Project["catalog"],
  endNodeTypes: readonly NodeType[],
  wallId: string
): Diagnostic[] {
  const types = new Set<string>();
  for (const placement of placements) {
    if (placement.kind !== "panel") continue;
    const panel = catalog.panels.find((p) => p.type === placement.panelType);
    if (panel && restrictedPanelMayLandOffJunction(panel, endNodeTypes)) types.add(panel.type);
  }
  return [...types].map((type) => ({
    code: "restricted-panel-off-junction",
    severity: "warning" as const,
    message: `${type} נבחר בקיר שבקצה אחד שלו צומת T ובקצה השני לא — ייתכן שהוא ממוקם בקצה שאינו צומת T`,
    wallIds: [wallId],
    nodeIds: [],
  }));
}

/** One independent stock ledger per pour: the same equipment is reused later. */
function inventoryLedger(
  project: Project
): Record<string, Record<string, number>> | undefined {
  if (!project.inventory) return undefined;
  const baseline = Object.fromEntries(
    project.catalog.panels.map((panel) => [
      panel.type,
      Math.max(0, Math.floor(project.inventory?.[panel.bomLabel] ?? 0)),
    ])
  );
  return Object.fromEntries(project.pours.map((pour) => [pour.id, { ...baseline }]));
}

function consumeStraightPanels(
  placements: Placement[],
  availability: Record<string, number> | undefined
): void {
  if (!availability) return;
  for (const placement of placements) {
    if (
      placement.kind !== "panel" ||
      !placement.panelType ||
      placement.flags.includes("inventory-shortage")
    )
      continue;
    availability[placement.panelType] = Math.max(
      0,
      (availability[placement.panelType] ?? 0) - 1
    );
  }
}

function missingPanelCounts(placements: Placement[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const placement of placements) {
    if (!placement.flags.includes("inventory-shortage") || !placement.panelType) continue;
    counts[placement.panelType] = (counts[placement.panelType] ?? 0) + 1;
  }
  return counts;
}

/** Back-compat shim for callers that only want the placements. */
export function tileProjectPlacements(project: Project, options: ResolveOptions = {}): Placement[] {
  return tileProject(project, options).placements;
}
