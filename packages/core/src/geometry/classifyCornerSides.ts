import type { CornerAtNode, CornerSide, Node, Point } from "../types.js";
import type { Dart, PlanarFacesResult } from "./planarFaces.js";
import { cross2, subtract } from "./vector.js";

export interface CornerRegionLookup {
  /** boundary cycle id → the region it bounds; cycles absent here are skipped */
  regionIdByCycleId: Map<string, string>;
  /** only these regions produce corners — wall material and the exterior don't */
  roomRegionIds: Set<string>;
}

export interface ClassifyCornerSidesResult {
  nodes: Node[];
  corners: CornerAtNode[];
}

/**
 * Decides, for every room a corner belongs to, whether that corner is concave
 * ('inner' — the notch of an L-shaped room) or convex ('outer' — a regular box
 * corner), by comparing the local turn to the bounding cycle's winding.
 *
 * Runs on the planar face traversal rather than on a hand-rolled loop walk, so
 * it no longer gives up the moment a T or cross junction appears: an interior
 * partition splits a room into two faces and each face classifies its own
 * corners. Corners that genuinely can't be resolved are flagged on the Node —
 * the previous implementation returned them silently classified as 'inner'.
 *
 * With no `lookup`, every bounded face is treated as its own room, which is the
 * right default before the contours layer has decided what is wall material.
 */
export function classifyCornerSides(
  nodes: Node[],
  faces: PlanarFacesResult,
  lookup?: CornerRegionLookup
): ClassifyCornerSidesResult {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edgeIdByDartId = new Map(
    [...faces.darts.values()].map((d) => [d.id, d.edgeId] as const)
  );

  const corners: CornerAtNode[] = [];
  const seen = new Set<string>();

  for (const cycle of faces.cycles) {
    if (cycle.isUnbounded) continue;

    const regionId = lookup ? lookup.regionIdByCycleId.get(cycle.id) : cycle.id;
    if (!regionId) continue;
    if (lookup && !lookup.roomRegionIds.has(regionId)) continue;

    const areaSign = Math.sign(cycle.signedArea);
    const count = cycle.dartIds.length;

    for (let i = 0; i < count; i++) {
      const node = nodeById.get(cycle.nodeIds[i]!);
      if (!node || node.type !== "L") continue;

      const incoming = faces.darts.get(cycle.dartIds[(i - 1 + count) % count]!)!;
      const outgoing = faces.darts.get(cycle.dartIds[i]!)!;
      const dirIn = directionOf(incoming, nodeById);
      const dirOut = directionOf(outgoing, nodeById);
      if (!dirIn || !dirOut) continue;

      const id = `corner:${node.id}:${regionId}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const turn = cross2(dirIn, dirOut);
      const turnDeg = (Math.atan2(turn, dirIn.x * dirOut.x + dirIn.y * dirOut.y) * 180) / Math.PI;

      corners.push({
        id,
        nodeId: node.id,
        regionId,
        cycleId: cycle.id,
        edgeAId: edgeIdByDartId.get(incoming.id)!,
        edgeBId: edgeIdByDartId.get(outgoing.id)!,
        side: Math.sign(turn) === areaSign ? "outer" : "inner",
        interiorAngleDeg: 180 - areaSign * turnDeg,
        flags: [],
      });
    }
  }

  return { nodes: annotateNodes(nodes, corners), corners };
}

function annotateNodes(nodes: Node[], corners: CornerAtNode[]): Node[] {
  const byNodeId = new Map<string, CornerAtNode[]>();
  for (const corner of corners) {
    byNodeId.set(corner.nodeId, [...(byNodeId.get(corner.nodeId) ?? []), corner]);
  }

  return nodes.map((node) => {
    if (node.type !== "L") return node;
    const found = byNodeId.get(node.id) ?? [];

    if (found.length === 0) {
      return { ...node, cornerSide: undefined, flags: withFlag(node.flags, "unresolved-corner-side") };
    }
    if (found.length > 1) {
      return { ...node, cornerSide: undefined, flags: withFlag(node.flags, "multi-region-corner") };
    }
    return { ...node, cornerSide: found[0]!.side as CornerSide };
  });
}

function directionOf(dart: Dart, nodeById: Map<string, Node>): Point | null {
  const from = nodeById.get(dart.from);
  const to = nodeById.get(dart.to);
  if (!from || !to) return null;
  const d = subtract(to.point, from.point);
  return d.x === 0 && d.y === 0 ? null : d;
}

function withFlag(flags: string[] | undefined, flag: string): string[] {
  const current = flags ?? [];
  return current.includes(flag) ? current : [...current, flag];
}
