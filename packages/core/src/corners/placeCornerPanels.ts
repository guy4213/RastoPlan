import type {
  AccessoryRules,
  Diagnostic,
  Edge,
  Node,
  PanelCatalog,
  Panel,
  Placement,
  PlacementSide,
  ResolvedWall,
  Wall,
} from "../types.js";
import type { WallResolution } from "../contours/resolveWalls.js";
import { faceRunFor } from "./faceRuns.js";
import type { FaceRun } from "./faceRuns.js";

export interface PlaceCornerPanelsInput {
  resolution: WallResolution;
  walls: Wall[];
  catalog: PanelCatalog;
  rules: AccessoryRules;
  /** Mutable remaining stock per pour and panel type; omitted = unlimited. */
  availablePanelCountsByPour?: Record<string, Record<string, number>>;
}

export interface PlaceCornerPanelsResult {
  /**
   * Corner-panel legs, one per meeting wall per room. Both legs of one physical
   * panel share `groupId` and must be counted once (its 1.8m² is both legs
   * together). A wall with a room on each side gets a panel on each face.
   */
  cornerPanels: Placement[];
  /**
   * Always empty. The outer corner used to get a separate overlap strip on
   * BOTH meeting walls, because nothing decided which panel wraps — that
   * showed up as two stray "+10" blocks. The overlap is now part of the real
   * straight runs: one carries across the corner and the other rides over it.
   */
  protrusions: Placement[];
  /** Edges with clearLength recomputed for the corner panels actually placed. */
  edges: Edge[];
  /**
   * Where each face's straight run starts and how long it is, per edge. The two
   * faces differ: the outer one wraps past every convex corner by the
   * neighbour's thickness plus its lapped joint, so it carries more panels
   * than the inner one.
   */
  runs: Map<string, Record<PlacementSide, FaceRun>>;
  diagnostics: Diagnostic[];
}

/**
 * Places the corner-adjacent formwork, driven by the resolved corners rather
 * than by raw node degree.
 *
 * Two things this fixes over counting corners per edge-end: a straight join
 * (one wall drawn as two segments) is no longer a corner at all, and a corner
 * shared by two rooms is correctly two corner panels rather than one.
 *
 * `offsetAlongEdge` is in the clear-run frame tileWall uses: 0..clearLength is
 * the tileable straight run, and corner-adjacent placements sit outside it.
 */
export function placeCornerPanels(input: PlaceCornerPanelsInput): PlaceCornerPanelsResult {
  const { resolution, walls, catalog, rules } = input;
  const nodeById = new Map(resolution.nodes.map((n) => [n.id, n]));
  const wallById = new Map(walls.map((w) => [w.id, w]));

  const cornerPanels: Placement[] = [];
  const protrusions: Placement[] = [];
  const runs = new Map<string, Record<PlacementSide, FaceRun>>();
  const diagnostics: Diagnostic[] = [];
  const cornerPanelById = new Map<string, Panel>();
  const cornerPanelWidthById = new Map<string, number>();
  const missingCornerIds = new Set<string>();

  // Reserve one physical corner unit before calculating the adjacent straight
  // runs. Both emitted legs then share this reservation through corner.id.
  for (const corner of resolution.corners) {
    const resolvedWall = resolution.wallByEdgeId.get(corner.edgeAId);
    const pourId = resolvedWall?.pourId ?? "";
    const availability = input.availablePanelCountsByPour?.[pourId];
    const stockedPanel = pickCornerPanel(catalog, availability);
    // No stocked corner fits: retain the preferred theoretical corner panel
    // and flag only that physical unit as missing. Its two legs still share
    // one groupId, so both the canvas and BOM understand it as one panel.
    const panel = stockedPanel ?? pickCornerPanel(catalog, undefined, availability !== undefined);
    if (!panel) {
      diagnostics.push({
        code: "inventory-corner-panel-shortage",
        severity: "error",
        message: "לא נמצא בקטלוג פאנל פינה עבור אחת הפינות",
        wallIds: [corner.edgeAId, corner.edgeBId].map((id) => id.replace(/^edge:/, "")),
        nodeIds: [corner.nodeId],
      });
      continue;
    }
    if (availability && !stockedPanel) {
      missingCornerIds.add(corner.id);
      diagnostics.push({
        code: "inventory-corner-panel-shortage",
        severity: "error",
        message: `חסר במלאי פאנל פינה ${panel.type}`,
        wallIds: [corner.edgeAId, corner.edgeBId].map((id) => id.replace(/^edge:/, "")),
        nodeIds: [corner.nodeId],
      });
    }
    cornerPanelById.set(corner.id, panel);
    cornerPanelWidthById.set(corner.id, panel.width);
    if (availability && stockedPanel) {
      availability[panel.type] = Math.max(0, (availability[panel.type] ?? 0) - 1);
    }
  }

  const cornersByEdgeId = new Map<string, typeof resolution.corners>();
  for (const corner of resolution.corners) {
    for (const edgeId of [corner.edgeAId, corner.edgeBId]) {
      cornersByEdgeId.set(edgeId, [...(cornersByEdgeId.get(edgeId) ?? []), corner]);
    }
  }

  const adjustedEdges: Edge[] = resolution.edges.map((edge) => {
    const resolvedWall = resolution.wallByEdgeId.get(edge.id);
    const wall = wallById.get(edge.wallId);
    if (!resolvedWall || !wall) return edge;

    const [a, b] = wall.innerLine;
    // Rounded to whole cm: a wall drawn even slightly off-axis has an
    // irrational length, and the tiling DP is indexed by whole centimetres —
    // a fractional clear run matches no combination at all and silently
    // collapses the entire wall into one timber filler.
    const geometricLength = Math.round(Math.hypot(b.x - a.x, b.y - a.y));

    const endCorners = {
      A: cornersAt(edge, "A", cornersByEdgeId, nodeById),
      B: cornersAt(edge, "B", cornersByEdgeId, nodeById),
    };

    const flags = [...edge.flags];
    for (const end of ["A", "B"] as const) {
      const nodeId = end === "A" ? edge.nodeA : edge.nodeB;
      const node = nodeById.get(nodeId);
      if (!node) continue;
      if (node.type === "T") pushOnce(flags, "unresolved-T");
      else if (node.type === "cross") pushOnce(flags, "unresolved-cross");
      else if (node.type === "straight-join") pushOnce(flags, "straight-join");
      else if (node.type === "L" && endCorners[end].length === 0) {
        pushOnce(flags, "unresolved-corner-side");
      }
      if (
        endCorners[end].some(
          (corner) => !cornerPanelById.has(corner.id) || missingCornerIds.has(corner.id)
        )
      ) {
        pushOnce(flags, "inventory-shortage");
      }
    }

    const runFor = (face: PlacementSide): FaceRun =>
      faceRunFor({
        edge,
        resolvedWall,
        face,
        geometricLength,
        cornersAtA: endCorners.A,
        cornersAtB: endCorners.B,
        cornerPanelWidthById,
        rules,
        edges: resolution.edges,
        nodeById,
        wallById,
      });

    const faceRuns = { faceA: runFor("faceA"), faceB: runFor("faceB") };
    runs.set(edge.id, faceRuns);

    // The interior run is what struts, dywidag and every existing calibration
    // read off the Edge; the outer face's own run lives in `runs`.
    const clearLength = faceRuns.faceA.clearLength;

    for (const end of ["A", "B"] as const) {
      for (const corner of endCorners[end]) {
        const cornerPanel = cornerPanelById.get(corner.id);
        if (!cornerPanel) continue;
        const cornerPanelWidth = cornerPanel.width;
        const face = faceForRegion(resolvedWall, corner.regionId);
        if (!face) continue;
        const run = faceRuns[face];

        cornerPanels.push({
          id: `placement:${edge.id}:corner:${end}:${face}`,
          groupId: corner.id,
          edgeId: edge.id,
          wallId: resolvedWall.id,
          pourId: resolvedWall.pourId,
          side: face,
          faceIsInterior: true,
          kind: "corner-panel",
          panelType: cornerPanel.type,
          offsetAlongEdge:
            end === "A" ? run.startOffset - cornerPanelWidth : run.startOffset + run.clearLength,
          width: cornerPanelWidth,
          source: "auto",
          flags: missingCornerIds.has(corner.id) ? ["inventory-shortage"] : [],
        });

      }
    }

    return { ...edge, clearLength, flags };
  });

  return { cornerPanels, protrusions, edges: adjustedEdges, runs, diagnostics };
}

function cornersAt(
  edge: Edge,
  end: "A" | "B",
  cornersByEdgeId: Map<string, WallResolution["corners"]>,
  nodeById: Map<string, Node>
) {
  const nodeId = end === "A" ? edge.nodeA : edge.nodeB;
  if (nodeById.get(nodeId)?.type !== "L") return [];
  return (cornersByEdgeId.get(edge.id) ?? []).filter((c) => c.nodeId === nodeId);
}

function faceForRegion(wall: ResolvedWall, regionId: string): PlacementSide | null {
  return wall.faces.find((f) => f.regionId === regionId)?.id ?? null;
}

/**
 * The catalog stocks corner panels in several leg sizes (15/20/25/30). Auto
 * layout uses the customer's leading one; taking the first in-stock match
 * would silently pick C15x15 just because it sorts first.
 */
function pickCornerPanel(
  catalog: PanelCatalog,
  availability?: Readonly<Record<string, number>>,
  inventoryDefinesAvailability = availability !== undefined
) {
  const corners = catalog.panels.filter(
    (p) =>
      p.kind === "corner" &&
      (p.inStock || inventoryDefinesAvailability) &&
      (availability === undefined || (availability[p.type] ?? 0) > 0)
  );
  return corners.find((p) => p.isLeading) ?? [...corners].sort((a, b) => b.width - a.width)[0];
}

function pushOnce(flags: string[], flag: string): void {
  if (!flags.includes(flag)) flags.push(flag);
}
