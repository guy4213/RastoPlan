import type {
  ExternalCorner,
  Placement,
  Point,
  ProjectLayout,
  Wall,
} from "@rastoplan/core";
import { PLACEMENT_BAND_DEPTH_CM, wallNormal } from "./geometry.js";
import { resolvedWallFrame } from "./resolvedWallFrame.js";

export interface CornerBracket {
  key: string;
  /** The angle's three points: end of one arm, elbow, end of the other. */
  points: number[];
  labelAt: Point;
  count: number;
}

/** K30: each visible arm follows 30cm of its panel run. */
const ARM_CM = 30;
/** Small drawing clearance beyond the actual painted panel band. */
const CLEARANCE_CM = 4;
const LABEL_OFFSET_CM = 16;

/**
 * Places K30 brackets from the visible panel bands themselves. This stays in a
 * pure module so the geometry can be tested without loading Konva/canvas.
 */
export function computeCornerBrackets(
  walls: Wall[],
  placements: Placement[],
  layout: ProjectLayout | undefined,
  clampsPerCorner: number,
  externalCorners?: readonly ExternalCorner[]
): CornerBracket[] {
  if (externalCorners) {
    return bracketsForExternalCorners(walls, layout, clampsPerCorner, externalCorners);
  }

  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const legsByGroup = new Map<string, Placement[]>();
  for (const placement of placements) {
    if (placement.kind !== "corner-panel" || !placement.groupId) continue;
    legsByGroup.set(placement.groupId, [
      ...(legsByGroup.get(placement.groupId) ?? []),
      placement,
    ]);
  }

  const brackets: CornerBracket[] = [];
  for (const [groupId, legs] of legsByGroup) {
    if (legs.length < 2) continue;

    const arms: { corner: Point; along: Point; outward: Point }[] = [];
    for (const leg of legs.slice(0, 2)) {
      const wall = wallById.get(leg.wallId);
      if (!wall) continue;
      const frame = resolvedWallFrame(wall, layout);
      const [a, b] = wall.innerLine;
      const wallLength = Math.hypot(b.x - a.x, b.y - a.y);
      if (wallLength === 0) continue;

      const atA = leg.offsetAlongEdge + leg.width / 2 < wallLength / 2;
      const vertex = atA ? a : b;
      const far = atA ? b : a;
      const normal = wallNormal(wall);
      const panelOutward =
        leg.side === "faceB" ? frame.outwardSign : (-frame.outwardSign as 1 | -1);
      const baseOffset =
        leg.side === "faceB" ? frame.faceBOffsetCm * frame.outwardSign : 0;
      const bracketOffset =
        baseOffset + panelOutward * (PLACEMENT_BAND_DEPTH_CM + CLEARANCE_CM);

      arms.push({
        corner: {
          x: vertex.x + normal.x * bracketOffset,
          y: vertex.y + normal.y * bracketOffset,
        },
        along: {
          x: (far.x - vertex.x) / wallLength,
          y: (far.y - vertex.y) / wallLength,
        },
        outward: { x: normal.x * panelOutward, y: normal.y * panelOutward },
      });
    }
    if (arms.length < 2) continue;

    const elbow =
      intersect(arms[0]!.corner, arms[0]!.along, arms[1]!.corner, arms[1]!.along) ??
      arms[0]!.corner;
    const bisector = normalize({
      x: arms[0]!.outward.x + arms[1]!.outward.x,
      y: arms[0]!.outward.y + arms[1]!.outward.y,
    });
    const tip = (arm: { along: Point }) => ({
      x: elbow.x + arm.along.x * ARM_CM,
      y: elbow.y + arm.along.y * ARM_CM,
    });
    const firstTip = tip(arms[0]!);
    const secondTip = tip(arms[1]!);

    brackets.push({
      key: groupId,
      points: [firstTip.x, firstTip.y, elbow.x, elbow.y, secondTip.x, secondTip.y],
      labelAt: {
        x: elbow.x + bisector.x * LABEL_OFFSET_CM,
        y: elbow.y + bisector.y * LABEL_OFFSET_CM,
      },
      count: Math.max(1, Math.round(clampsPerCorner)),
    });
  }

  return brackets;
}

/**
 * Draws the engine-derived outside corners directly from graph nodes. Unlike the
 * legacy path, this does not need a closed-room corner panel to exist first:
 * an outside facade can stay open at a door and still receive its K30.
 */
function bracketsForExternalCorners(
  walls: Wall[],
  layout: ProjectLayout | undefined,
  clampsPerCorner: number,
  corners: readonly ExternalCorner[]
): CornerBracket[] {
  if (!layout) return [];

  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const brackets: CornerBracket[] = [];
  const seenCorners = new Set<string>();

  for (const corner of corners) {
    const node = layout.nodes.find(
      (candidate) =>
        Math.hypot(candidate.point.x - corner.point.x, candidate.point.y - corner.point.y) < 0.5
    );
    const cornerKey = node ? `${node.id}:${corner.pourId}` : "";
    if (!node || seenCorners.has(cornerKey)) continue;

    const incident = layout.edges.filter(
      (edge) => edge.nodeA === node.id || edge.nodeB === node.id
    );
    const arms = incident
      .map((edge) => {
        const wall = wallById.get(edge.wallId);
        if (!wall || wall.pourId !== corner.pourId) return null;
        const otherId = edge.nodeA === node.id ? edge.nodeB : edge.nodeA;
        const other = nodeById.get(otherId);
        if (!other) return null;
        const length = Math.hypot(
          other.point.x - node.point.x,
          other.point.y - node.point.y
        );
        if (length === 0) return null;
        return {
          along: {
            x: (other.point.x - node.point.x) / length,
            y: (other.point.y - node.point.y) / length,
          },
        };
      })
      .filter((arm): arm is { along: Point } => arm !== null);
    if (arms.length !== 2) continue;

    const outside = normalize({
      x: -(arms[0]!.along.x + arms[1]!.along.x),
      y: -(arms[0]!.along.y + arms[1]!.along.y),
    });
    const componentOffset = PLACEMENT_BAND_DEPTH_CM + CLEARANCE_CM;
    const elbow = {
      x: node.point.x + outside.x * componentOffset * Math.SQRT2,
      y: node.point.y + outside.y * componentOffset * Math.SQRT2,
    };
    const tip = (arm: { along: Point }) => ({
      x: elbow.x + arm.along.x * ARM_CM,
      y: elbow.y + arm.along.y * ARM_CM,
    });
    const firstTip = tip(arms[0]!);
    const secondTip = tip(arms[1]!);

    seenCorners.add(cornerKey);
    brackets.push({
      key: `external:${cornerKey}`,
      points: [firstTip.x, firstTip.y, elbow.x, elbow.y, secondTip.x, secondTip.y],
      labelAt: {
        x: elbow.x + outside.x * LABEL_OFFSET_CM,
        y: elbow.y + outside.y * LABEL_OFFSET_CM,
      },
      count: Math.max(1, Math.round(clampsPerCorner)),
    });
  }

  return brackets;
}

function intersect(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const denominator = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denominator;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

function normalize(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  return length === 0
    ? { x: 0, y: -1 }
    : { x: vector.x / length, y: vector.y / length };
}
