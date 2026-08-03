import { useState } from "react";
import { Circle } from "react-konva";
import type Konva from "konva";
import type { Point, Wall } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";

interface Props {
  walls: Wall[];
  scale: number;
}

interface EndpointRef {
  wallId: string;
  end: 0 | 1;
  point: Point;
}

/**
 * Clickable endpoint dots for the weld tool. Pick two, and both walls
 * get that shared vertex (midpoint of the two) so downstream corner
 * detection sees a real junction — not "0.4 cm apart, close enough".
 */
export function WeldOverlay({ walls, scale }: Props) {
  const { dispatch } = useProject();
  const [first, setFirst] = useState<EndpointRef | null>(null);

  const dotRadius = 7 / scale;

  const handleClick = (ref: EndpointRef, e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    if (!first) {
      setFirst(ref);
      return;
    }
    if (first.wallId === ref.wallId && first.end === ref.end) {
      // Clicked the same handle twice — treat as deselect.
      setFirst(null);
      return;
    }
    const at: Point = {
      x: (first.point.x + ref.point.x) / 2,
      y: (first.point.y + ref.point.y) / 2,
    };
    dispatch({
      type: "weld-endpoints",
      refs: [
        { wallId: first.wallId, end: first.end },
        { wallId: ref.wallId, end: ref.end },
      ],
      at,
    });
    setFirst(null);
  };

  const refs: EndpointRef[] = [];
  for (const w of walls) {
    refs.push({ wallId: w.id, end: 0, point: w.innerLine[0] });
    refs.push({ wallId: w.id, end: 1, point: w.innerLine[1] });
  }

  return (
    <>
      {refs.map((ref) => {
        const isFirst = first && first.wallId === ref.wallId && first.end === ref.end;
        return (
          <Circle
            key={`${ref.wallId}:${ref.end}`}
            x={ref.point.x}
            y={ref.point.y}
            radius={dotRadius}
            fill={isFirst ? "#f59e0b" : "#fff"}
            stroke={isFirst ? "#b45309" : "#0f172a"}
            strokeWidth={2 / scale}
            onClick={(e) => handleClick(ref, e)}
            onTap={(e) => handleClick(ref, e as Konva.KonvaEventObject<MouseEvent>)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "pointer";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "";
            }}
          />
        );
      })}
    </>
  );
}
