import type {
  AccessoryRules,
  Edge,
  Node,
  PanelCatalog,
  Placement,
  PlacementSide,
  ResolvedWall,
  Wall,
} from "../types.js";
import type { WallResolution } from "../contours/resolveWalls.js";
import { otherWallThicknessAt } from "../geometry/neighborThickness.js";
import { outerCornerProtrusionFor } from "./outerCornerProtrusion.js";

export interface PlaceCornerPanelsInput {
  resolution: WallResolution;
  walls: Wall[];
  catalog: PanelCatalog;
  rules: AccessoryRules;
}

export interface PlaceCornerPanelsResult {
  /**
   * Corner-panel legs, one per meeting wall per room. Both legs of one physical
   * panel share `groupId` and must be counted once (its 1.8m² is both legs
   * together). A wall with a room on each side gets a panel on each face.
   */
  cornerPanels: Placement[];
  /**
   * Overlap strips where two straight panels meet at a convex corner. Only on
   * faces that don't border a room — a partition between two rooms has a corner
   * panel on both sides and no overlap anywhere.
   */
  protrusions: Placement[];
  /** Edges with clearLength recomputed for the corner panels actually placed. */
  edges: Edge[];
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

  const cornerPanel = pickCornerPanel(catalog);
  const cornerPanelWidth = cornerPanel?.width ?? 30;
  const cornerPanelType = cornerPanel?.type ?? "C30x30";

  const cornerPanels: Placement[] = [];
  const protrusions: Placement[] = [];

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
    const geometricLength = Math.hypot(b.x - a.x, b.y - a.y);

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
    }

    // Each end loses one corner-panel leg's worth of run when any face there
    // carries a corner panel. Straight joins and free ends consume nothing.
    const deduction =
      (endCorners.A.length > 0 ? cornerPanelWidth : 0) +
      (endCorners.B.length > 0 ? cornerPanelWidth : 0);
    const clearLength = Math.max(0, geometricLength - deduction);

    for (const end of ["A", "B"] as const) {
      for (const corner of endCorners[end]) {
        const face = faceForRegion(resolvedWall, corner.regionId);
        if (!face) continue;

        cornerPanels.push({
          id: `placement:${edge.id}:corner:${end}:${face}`,
          groupId: corner.id,
          edgeId: edge.id,
          wallId: resolvedWall.id,
          pourId: resolvedWall.pourId,
          side: face,
          faceIsInterior: true,
          kind: "corner-panel",
          panelType: cornerPanelType,
          offsetAlongEdge: end === "A" ? -cornerPanelWidth : clearLength,
          width: cornerPanelWidth,
          source: "auto",
          flags: [],
        });

        if (corner.side !== "outer") continue;

        const exterior = otherFace(resolvedWall, face);
        if (exterior.isInterior) continue;

        const protrusion = outerCornerProtrusionFor(
          otherWallThicknessAt(
            end === "A" ? edge.nodeA : edge.nodeB,
            edge,
            resolution.edges,
            wallById
          ),
          rules
        );
        protrusions.push({
          id: `placement:${edge.id}:protrusion:${end}`,
          edgeId: edge.id,
          wallId: resolvedWall.id,
          pourId: resolvedWall.pourId,
          side: exterior.id,
          faceIsInterior: false,
          kind: "panel",
          panelType: "",
          offsetAlongEdge: end === "A" ? -protrusion : clearLength,
          width: protrusion,
          source: "auto",
          flags: ["outer-corner-protrusion"],
        });
      }
    }

    return { ...edge, clearLength, flags };
  });

  return { cornerPanels, protrusions, edges: adjustedEdges };
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

function otherFace(wall: ResolvedWall, face: PlacementSide) {
  return wall.faces.find((f) => f.id !== face) ?? wall.faces[1];
}

/**
 * The catalog stocks corner panels in several leg sizes (15/20/25/30). Auto
 * layout uses the customer's leading one; taking the first in-stock match
 * would silently pick C15x15 just because it sorts first.
 */
function pickCornerPanel(catalog: PanelCatalog) {
  const corners = catalog.panels.filter((p) => p.kind === "corner" && p.inStock);
  return corners.find((p) => p.isLeading) ?? corners[0];
}

function pushOnce(flags: string[], flag: string): void {
  if (!flags.includes(flag)) flags.push(flag);
}
