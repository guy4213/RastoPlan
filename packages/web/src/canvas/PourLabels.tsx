import { useMemo } from "react";
import { Text } from "react-konva";
import { pourLabelAnchors } from "@rastoplan/core";
import type { Pour, Wall } from "@rastoplan/core";

interface Props {
  walls: Wall[];
  pours: Pour[];
  scale: number;
}

/**
 * One name label per connected group of a pour's walls (core/pourLabelAnchors
 * decides how many that is — a pour drawn as two separate rooms gets two).
 * Kept out of Canvas.tsx by design: this file only renders, the lead wires it
 * into the layer stack once the pour-label anchors are approved.
 */
export function PourLabels({ walls, pours, scale }: Props) {
  const anchors = useMemo(() => pourLabelAnchors(walls, pours), [walls, pours]);
  const colorByPourId = useMemo(() => new Map(pours.map((pour) => [pour.id, pour.color])), [pours]);
  const fontSize = 16 / scale;

  return (
    <>
      {anchors.map((anchor) => (
        <Text
          key={`${anchor.pourId}:${anchor.wallIds.join(",")}`}
          x={anchor.point.x}
          y={anchor.point.y}
          text={anchor.name}
          fontSize={fontSize}
          fontStyle="bold"
          fill={colorByPourId.get(anchor.pourId) ?? "#0f172a"}
          align="center"
          offsetX={(anchor.name.length * fontSize * 0.3)}
          offsetY={fontSize / 2}
          listening={false}
        />
      ))}
    </>
  );
}
