import { useMemo } from "react";
import { Group, Line, Text } from "react-konva";
import type {
  AccessoryRules,
  ExternalCorner,
  Placement,
  ProjectLayout,
  Wall,
} from "@rastoplan/core";
import { computeCornerBrackets } from "./cornerClampGeometry.js";

interface Props {
  walls: Wall[];
  placements: Placement[];
  layout: ProjectLayout | undefined;
  rules: AccessoryRules;
  scale: number;
  externalCorners?: readonly ExternalCorner[];
}

export function CornerClamps({
  walls,
  placements,
  layout,
  rules,
  scale,
  externalCorners,
}: Props) {
  const brackets = useMemo(
    () =>
      computeCornerBrackets(
        walls,
        placements,
        layout,
        rules.cornerClampsPerCorner,
        externalCorners
      ),
    [walls, placements, layout, rules.cornerClampsPerCorner, externalCorners]
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
