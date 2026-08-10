import type {
  CornerAtNode,
  Diagnostic,
  Edge,
  Node,
  OutwardSign,
  ResolvedWall,
  ResolvedWallFace,
  Wall,
} from "../types.js";
import { buildGraph } from "../geometry/buildGraph.js";
import { classifyNodes } from "../geometry/classifyNodes.js";
import { classifyCornerSides } from "../geometry/classifyCornerSides.js";
import { buildPlanarFaces } from "../geometry/planarFaces.js";
import type { PlanarFacesResult } from "../geometry/planarFaces.js";
import { unitNormal } from "../geometry/polygon.js";
import { deriveOuterLine } from "../corners/deriveOuterLine.js";
import { THICKNESS_MISMATCH_TOLERANCE_CM, withDefaults } from "./constants.js";
import type { ResolveOptions } from "./constants.js";
import { buildRegions, OUTSIDE_REGION_ID } from "./regions.js";
import type { Region } from "./regions.js";
import { pairFaces } from "./pairFaces.js";
import type { FacePairing } from "./pairFaces.js";

export type { Diagnostic, OutwardSign, ResolvedWall, ResolvedWallFace };

export interface WallResolution {
  nodes: Node[];
  edges: Edge[];
  resolvedWalls: ResolvedWall[];
  wallByEdgeId: Map<string, ResolvedWall>;
  consumedWallIds: Set<string>;
  regions: Region[];
  corners: CornerAtNode[];
  pairings: FacePairing[];
  faces: PlanarFacesResult;
  diagnostics: Diagnostic[];
}

/**
 * Turns whatever the user drew — one contour per wall, or the two contours of
 * an architectural plan — into walls with an unambiguous outward direction and
 * a known interior/exterior face.
 *
 * This is the layer the double-placement bug was missing. Before it, the outer
 * face was placed along each wall's own drag direction, so half a rectangle's
 * outer band could land inside the room; and a plan traced as two rectangles
 * became two independent wall sets, each mirrored again onto its own far face.
 */
export function resolveWalls(walls: Wall[], options: ResolveOptions = {}): WallResolution {
  const resolved = withDefaults(options);
  const diagnostics: Diagnostic[] = [];

  const { nodes: rawNodes, edges } = buildGraph(walls);
  const typedNodes = classifyNodes(rawNodes, edges, {
    straightJoinToleranceDeg: resolved.straightJoinToleranceDeg,
  });
  const faces = buildPlanarFaces(typedNodes, edges);

  if (faces.flags.includes("edge-crossing-without-node")) {
    diagnostics.push({
      code: "edge-crossing-without-node",
      severity: "error",
      message: "קירות מצטלבים ללא נקודת חיבור — הגיאומטריה לא ניתנת לפירוש",
      wallIds: [],
      nodeIds: [],
    });
  }

  const { regions: rawRegions, regionIdByCycleId } = buildRegions(faces, typedNodes);
  const { pairings, coverageByRegionId } = pairFaces(typedNodes, faces, rawRegions, resolved);
  const regions = classifyRegionKinds(rawRegions, coverageByRegionId, resolved, diagnostics);

  const roomRegionIds = new Set(
    regions.filter((r) => r.kind === "room" || r.kind === "ambiguous").map((r) => r.id)
  );
  const { nodes, corners } = classifyCornerSides(typedNodes, faces, {
    regionIdByCycleId,
    roomRegionIds,
  });

  const wallById = new Map(walls.map((w) => [w.id, w]));
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const regionById = new Map(regions.map((r) => [r.id, r]));
  const sides = buildEdgeSides(edges, faces, regionIdByCycleId);

  // Only a region we are confident is wall material may consume a wall. An
  // 'ambiguous' ring is treated as a room, and a room's two sides are two real
  // walls — consuming one there would delete formwork the crew needs.
  const materialPairings = pairings.filter(
    (p) => regionById.get(p.betweenRegionId)?.kind === "wall-material"
  );
  const pairingByEdgeId = new Map<string, FacePairing>();
  for (const pairing of materialPairings) {
    pairingByEdgeId.set(pairing.edgeAId, pairing);
    pairingByEdgeId.set(pairing.edgeBId, pairing);
  }

  const consumedWallIds = new Set<string>();
  const consumedEdgeIds = new Set<string>();
  const resolvedWalls: ResolvedWall[] = [];
  const wallByEdgeId = new Map<string, ResolvedWall>();

  const isRoom = (regionId: string | undefined) =>
    !!regionId && roomRegionIds.has(regionId);

  for (const edge of edges) {
    if (consumedEdgeIds.has(edge.id)) continue;
    const wall = wallById.get(edge.wallId);
    const side = sides.get(edge.id);
    if (!wall || !side) continue;

    const pairing = pairingByEdgeId.get(edge.id);
    const partnerEdgeId = pairing
      ? pairing.edgeAId === edge.id
        ? pairing.edgeBId
        : pairing.edgeAId
      : undefined;
    const partnerEdge = partnerEdgeId ? edgeById.get(partnerEdgeId) : undefined;
    const partnerSide = partnerEdgeId ? sides.get(partnerEdgeId) : undefined;
    const partnerWall = partnerEdge ? wallById.get(partnerEdge.wallId) : undefined;

    if (pairing && partnerEdge && partnerSide && partnerWall) {
      const mine = roomCountOf(side, isRoom);
      const theirs = roomCountOf(partnerSide, isRoom);
      const iAmPrimary =
        mine !== theirs ? mine > theirs : edge.id <= partnerEdge.id;

      if (!iAmPrimary) continue;
      consumedEdgeIds.add(partnerEdge.id);
      consumedWallIds.add(partnerWall.id);

      if (mine === theirs && mine > 0) {
        diagnostics.push({
          code: "both-contours-bound-rooms",
          severity: "warning",
          message: `שני הקווים של הקיר גובלים בחדר — נבחר ${wall.id} כפאה הפנימית`,
          wallIds: [wall.id, partnerWall.id],
          nodeIds: [],
        });
      }
      if (wall.pourId !== partnerWall.pourId) {
        diagnostics.push({
          code: "pour-mismatch",
          severity: "warning",
          message: `שני הקווים של הקיר שויכו ליציקות שונות — נשמרה היציקה של ${wall.id}`,
          wallIds: [wall.id, partnerWall.id],
          nodeIds: [],
        });
      }

      resolvedWalls.push(
        buildPairedWall(wall, edge, side, partnerWall, partnerSide, pairing, regionById, diagnostics)
      );
      continue;
    }

    if (bordersWallMaterial(side, regionById)) {
      diagnostics.push({
        code: "contour-unpaired-segment",
        severity: "warning",
        message: `לקיר ${wall.id} לא נמצאה פאה נגדית בקונטור השני — הוא ישובץ כקיר עצמאי`,
        wallIds: [wall.id],
        nodeIds: [],
      });
    }

    resolvedWalls.push(buildUnpairedWall(wall, side, isRoom, regionById));
  }

  for (const resolvedWall of resolvedWalls) {
    wallByEdgeId.set(`edge:${resolvedWall.id}`, resolvedWall);
  }

  reportAutoPairings(materialPairings, edgeById, diagnostics);
  reportThicknessMismatches(resolvedWalls, wallById, diagnostics);

  return {
    nodes,
    edges,
    resolvedWalls,
    wallByEdgeId,
    consumedWallIds,
    regions,
    corners,
    pairings: materialPairings,
    faces,
    diagnostics,
  };
}

/** The region on each side of an edge, in that edge's own nodeA→nodeB frame. */
interface EdgeSides {
  /** region on the +(dy,-dx) side of nodeA→nodeB */
  positiveRegionId?: string;
  /** region on the -(dy,-dx) side */
  negativeRegionId?: string;
}

function buildEdgeSides(
  edges: Edge[],
  faces: PlanarFacesResult,
  regionIdByCycleId: Map<string, string>
): Map<string, EdgeSides> {
  const result = new Map<string, EdgeSides>();
  for (const edge of edges) {
    const forward = faces.cycleIdByDartId.get(`dart:${edge.id}:AB`);
    const backward = faces.cycleIdByDartId.get(`dart:${edge.id}:BA`);
    if (!forward || !backward) continue;

    // The forward dart's region sits on regionSideOfDart of nodeA→nodeB; the
    // backward dart's frame is mirrored, so its region sits on the other side.
    const forwardRegionId = regionIdByCycleId.get(forward);
    const backwardRegionId = regionIdByCycleId.get(backward);
    result.set(
      edge.id,
      faces.regionSideOfDart === 1
        ? { positiveRegionId: forwardRegionId, negativeRegionId: backwardRegionId }
        : { positiveRegionId: backwardRegionId, negativeRegionId: forwardRegionId }
    );
  }
  return result;
}

function roomCountOf(side: EdgeSides, isRoom: (id: string | undefined) => boolean): number {
  return (isRoom(side.positiveRegionId) ? 1 : 0) + (isRoom(side.negativeRegionId) ? 1 : 0);
}

function bordersWallMaterial(side: EdgeSides, regionById: Map<string, Region>): boolean {
  return [side.positiveRegionId, side.negativeRegionId].some(
    (id) => id && regionById.get(id)?.kind === "wall-material"
  );
}

function buildPairedWall(
  wall: Wall,
  edge: Edge,
  side: EdgeSides,
  partnerWall: Wall,
  partnerSide: EdgeSides,
  pairing: FacePairing,
  regionById: Map<string, Region>,
  diagnostics: Diagnostic[]
): ResolvedWall {
  const materialRegionId = pairing.betweenRegionId;
  const faceASign: OutwardSign = side.positiveRegionId === materialRegionId ? -1 : 1;
  const outwardSign = measuredOutwardSign(wall, partnerWall);

  if (outwardSign !== -faceASign) {
    diagnostics.push({
      code: "outward-sign-conflict",
      severity: "error",
      message: `כיוון החוץ של ${wall.id} שנגזר מהפאות סותר את המדידה — התקבלה המדידה`,
      wallIds: [wall.id, partnerWall.id],
      nodeIds: [],
    });
  }

  const faceARegionId =
    (faceASign === 1 ? side.positiveRegionId : side.negativeRegionId) ?? OUTSIDE_REGION_ID;
  const faceBRegionId =
    (partnerSide.positiveRegionId === materialRegionId
      ? partnerSide.negativeRegionId
      : partnerSide.positiveRegionId) ?? OUTSIDE_REGION_ID;

  const flags: string[] = [...pairing.flags];
  if (edge.flags.length > 0) flags.push(...edge.flags);

  return {
    id: wall.id,
    pourId: wall.pourId,
    sourceWallId: wall.id,
    consumedWallIds: [partnerWall.id],
    centerline: [{ ...wall.innerLine[0] }, { ...wall.innerLine[1] }],
    thickness: pairing.measuredThicknessCm,
    thicknessSource: "measured",
    outwardSign,
    faces: [
      {
        id: "faceA",
        line: [{ ...wall.innerLine[0] }, { ...wall.innerLine[1] }],
        isInterior: isInteriorRegion(faceARegionId, regionById),
        regionId: faceARegionId,
        sourceWallId: wall.id,
      },
      {
        id: "faceB",
        line: [{ ...partnerWall.innerLine[0] }, { ...partnerWall.innerLine[1] }],
        isInterior: isInteriorRegion(faceBRegionId, regionById),
        regionId: faceBRegionId,
        sourceWallId: partnerWall.id,
      },
    ],
    flags,
  };
}

function buildUnpairedWall(
  wall: Wall,
  side: EdgeSides,
  isRoom: (id: string | undefined) => boolean,
  regionById: Map<string, Region>
): ResolvedWall {
  // The drawn line is the inner face by the data model's definition, so face A
  // takes the room side whenever exactly one side is a room.
  const faceASign: OutwardSign =
    isRoom(side.positiveRegionId) || !isRoom(side.negativeRegionId) ? 1 : -1;
  const outwardSign: OutwardSign = faceASign === 1 ? -1 : 1;

  const faceARegionId =
    (faceASign === 1 ? side.positiveRegionId : side.negativeRegionId) ?? OUTSIDE_REGION_ID;
  const faceBRegionId =
    (faceASign === 1 ? side.negativeRegionId : side.positiveRegionId) ?? OUTSIDE_REGION_ID;

  return {
    id: wall.id,
    pourId: wall.pourId,
    sourceWallId: wall.id,
    consumedWallIds: [],
    centerline: [{ ...wall.innerLine[0] }, { ...wall.innerLine[1] }],
    thickness: wall.thickness,
    thicknessSource: "declared",
    outwardSign,
    faces: [
      {
        id: "faceA",
        line: [{ ...wall.innerLine[0] }, { ...wall.innerLine[1] }],
        isInterior: isInteriorRegion(faceARegionId, regionById),
        regionId: faceARegionId,
        sourceWallId: wall.id,
      },
      {
        id: "faceB",
        line: deriveOuterLine(wall, outwardSign),
        isInterior: isInteriorRegion(faceBRegionId, regionById),
        regionId: faceBRegionId,
      },
    ],
    flags: [],
  };
}

function isInteriorRegion(regionId: string, regionById: Map<string, Region>): boolean {
  const kind = regionById.get(regionId)?.kind;
  return kind === "room" || kind === "ambiguous";
}

function measuredOutwardSign(wall: Wall, partnerWall: Wall): OutwardSign {
  const n = unitNormal(wall.innerLine[0], wall.innerLine[1]);
  if (!n) return 1;
  const target = {
    x: (partnerWall.innerLine[0].x + partnerWall.innerLine[1].x) / 2 - wall.innerLine[0].x,
    y: (partnerWall.innerLine[0].y + partnerWall.innerLine[1].y) / 2 - wall.innerLine[0].y,
  };
  return target.x * n.x + target.y * n.y >= 0 ? 1 : -1;
}

function classifyRegionKinds(
  regions: Region[],
  coverageByRegionId: Map<string, number>,
  options: ReturnType<typeof withDefaults>,
  diagnostics: Diagnostic[]
): Region[] {
  return regions.map((region) => {
    if (region.kind === "outside") return region;

    // Wall material is the space BETWEEN two contours, so it always wraps
    // something: no hole, no wall. Without this a plain rectangular room pairs
    // its own two long walls against each other and declares itself solid
    // concrete — they are parallel, evenly spaced, and face each other exactly
    // like the two sides of a wall do.
    if (region.holeCycleIds.length === 0) {
      return { ...region, kind: "room" as const, pairedCoverage: 0 };
    }

    const coverage = coverageByRegionId.get(region.id) ?? 0;
    if (coverage >= options.materialMinCoverage) {
      return { ...region, kind: "wall-material" as const, pairedCoverage: coverage };
    }
    if (coverage >= options.materialAmbiguousCoverage) {
      diagnostics.push({
        code: "region-coverage-ambiguous",
        severity: "warning",
        message: `אזור ${region.id} מזווג חלקית (${Math.round(coverage * 100)}%) — טופל כחדר, כדאי לבדוק`,
        wallIds: [],
        nodeIds: [],
      });
      return {
        ...region,
        kind: "ambiguous" as const,
        pairedCoverage: coverage,
        flags: [...region.flags, "region-coverage-ambiguous"],
      };
    }
    return { ...region, kind: "room" as const, pairedCoverage: coverage };
  });
}

/**
 * A 30cm duct and a 30cm wall are the same two parallel lines. Until the
 * customer tells us what distinguishes them, every auto-detected ring is listed
 * so the engineer can eyeball it rather than discover it in the BOM.
 */
function reportAutoPairings(
  pairings: FacePairing[],
  edgeById: Map<string, Edge>,
  diagnostics: Diagnostic[]
): void {
  if (pairings.length === 0) return;
  const wallIds = pairings.flatMap((p) =>
    [edgeById.get(p.edgeAId)?.wallId, edgeById.get(p.edgeBId)?.wallId].filter(
      (id): id is string => !!id
    )
  );
  diagnostics.push({
    code: "auto-paired-contours",
    severity: "info",
    message: `${pairings.length} זוגות קווים זוהו אוטומטית כשתי הפאות של קיר`,
    wallIds,
    nodeIds: [],
  });
}

function reportThicknessMismatches(
  resolvedWalls: ResolvedWall[],
  wallById: Map<string, Wall>,
  diagnostics: Diagnostic[]
): void {
  for (const resolvedWall of resolvedWalls) {
    if (resolvedWall.thicknessSource !== "measured") continue;
    const declared = wallById.get(resolvedWall.sourceWallId)?.thickness;
    if (declared === undefined) continue;
    if (Math.abs(declared - resolvedWall.thickness) <= THICKNESS_MISMATCH_TOLERANCE_CM) continue;

    diagnostics.push({
      code: "thickness-mismatch",
      severity: "warning",
      message: `העובי שנמדד לקיר ${resolvedWall.sourceWallId} הוא ${resolvedWall.thickness.toFixed(1)} ס"מ, אך הוקלד ${declared} ס"מ`,
      wallIds: [resolvedWall.sourceWallId],
      nodeIds: [],
    });
  }
}
