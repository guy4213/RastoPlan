import { useMemo } from "react";
import { Group, Line, Text } from "react-konva";
import type { AccessoryRules, Placement, Point, ProjectLayout, Wall } from "@rastoplan/core";
import { wallNormal } from "./geometry.js";
import { resolvedWallFrame } from "./resolvedWallFrame.js";

interface Props {
  walls: Wall[];
  placements: Placement[];
  layout: ProjectLayout | undefined;
  rules: AccessoryRules;
  scale: number;
}

interface CornerBracket {
  key: string;
  /** the angle's three points: end of one arm, the elbow, end of the other */
  points: number[];
  labelAt: Point;
  count: number;
}

/** How far each arm of the bracket reaches along its wall. */
const ARM_CM = 45;
/** How far the bracket stands off the outer face, so it reads as wrapping it. */
const STANDOFF_CM = 7;

/**
 * K30 corner clamps wrap the OUTSIDE of a corner, straddling the joint where
 * the two outer panels meet — the assembly drawn in the customer's AutoCAD
 * detail. They belong nowhere near the inner corner panel, and a wall with a
 * room on both sides has no outside and gets none.
 *
 * The count still comes from the BOM; this only puts it on the drawing.
 */
function computeBrackets(
  walls: Wall[],
  placements: Placement[],
  layout: ProjectLayout | undefined,
  clampsPerCorner: number
): CornerBracket[] {
  const wallById = new Map(walls.map((w) => [w.id, w]));

  const legsByGroup = new Map<string, Placement[]>();
  for (const p of placements) {
    if (p.kind !== "corner-panel" || !p.groupId) continue;
    legsByGroup.set(p.groupId, [...(legsByGroup.get(p.groupId) ?? []), p]);
  }

  const brackets: CornerBracket[] = [];
  for (const [groupId, legs] of legsByGroup) {
    // One physical corner is two legs, one per meeting wall. Their directions
    // are what give the bracket its two arms, so a lone leg can't be drawn.
    if (legs.length < 2) continue;

    const arms: { corner: Point; along: Point }[] = [];
    let exterior = true;

    for (const leg of legs.slice(0, 2)) {
      const wall = wallById.get(leg.wallId);
      if (!wall) continue;
      const frame = resolvedWallFrame(wall, layout);
      if (leg.side === "faceB" ? frame.faceAIsInterior : frame.faceBIsInterior) {
        exterior = false;
        break;
      }

      const [a, b] = wall.innerLine;
      const wallLength = Math.hypot(b.x - a.x, b.y - a.y);
      if (wallLength === 0) continue;
      // Which end of the wall this leg sits at, from where it lands along the
      // wall rather than from the sign of its offset — the near leg starts at 0
      // now that the straight run begins after it, not at a negative offset.
      const atA = leg.offsetAlongEdge + leg.width / 2 < wallLength / 2;
      const vertex = atA ? a : b;
      const far = atA ? b : a;
      const length = wallLength;

      const n = wallNormal(wall);
      const outward = leg.side === "faceB" ? -frame.outwardSign : frame.outwardSign;
      arms.push({
        corner: {
          x: vertex.x + n.x * outward * frame.faceBOffsetCm,
          y: vertex.y + n.y * outward * frame.faceBOffsetCm,
        },
        along: { x: (far.x - vertex.x) / length, y: (far.y - vertex.y) / length },
      });
    }

    if (!exterior || arms.length < 2) continue;

    // The two legs' outer corners are the same physical point; average out any
    // sub-centimetre disagreement between the two walls' offsets.
    const elbow = {
      x: (arms[0]!.corner.x + arms[1]!.corner.x) / 2,
      y: (arms[0]!.corner.y + arms[1]!.corner.y) / 2,
    };
    // Push the whole bracket out along the corner's bisector so it sits clear
    // of the panels rather than on top of them.
    const bisector = normalize({
      x: -(arms[0]!.along.x + arms[1]!.along.x),
      y: -(arms[0]!.along.y + arms[1]!.along.y),
    });
    const shift = { x: bisector.x * STANDOFF_CM, y: bisector.y * STANDOFF_CM };
    const tip = (arm: { along: Point }) => ({
      x: elbow.x + arm.along.x * ARM_CM + shift.x,
      y: elbow.y + arm.along.y * ARM_CM + shift.y,
    });

    const p0 = tip(arms[0]!);
    const p1 = { x: elbow.x + shift.x, y: elbow.y + shift.y };
    const p2 = tip(arms[1]!);

    brackets.push({
      key: groupId,
      points: [p0.x, p0.y, p1.x, p1.y, p2.x, p2.y],
      labelAt: { x: elbow.x + bisector.x * (STANDOFF_CM + 18), y: elbow.y + bisector.y * (STANDOFF_CM + 18) },
      count: Math.max(1, Math.round(clampsPerCorner)),
    });
  }

  return brackets;
}

function normalize(v: Point): Point {
  const length = Math.hypot(v.x, v.y);
  return length === 0 ? { x: 0, y: -1 } : { x: v.x / length, y: v.y / length };
}

export function CornerClamps({ walls, placements, layout, rules, scale }: Props) {
  const brackets = useMemo(
    () => computeBrackets(walls, placements, layout, rules.cornerClampsPerCorner),
    [walls, placements, layout, rules.cornerClampsPerCorner]
  );

  return (
    <>
      {brackets.map((b) => (
        <Group key={`k30:${b.key}`} listening={false}>
          <Line
            points={b.points}
            stroke="#7c2d12"
            strokeWidth={11}
            lineJoin="round"
            lineCap="round"
            opacity={0.9}
          />
          <Line
            points={b.points}
            stroke="#fb923c"
            strokeWidth={7}
            lineJoin="round"
            lineCap="round"
          />
          <Text
            x={b.labelAt.x}
            y={b.labelAt.y}
            text={`K30×${b.count}`}
            fontSize={11 / scale}
            fontStyle="bold"
            fill="#7c2d12"
            offsetX={16 / scale}
            offsetY={5 / scale}
          />
        </Group>
      ))}
    </>
  );
}
