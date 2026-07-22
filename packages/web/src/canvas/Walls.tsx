import { Group, Line } from "react-konva";
import type { Point, Pour, Wall } from "@rastoplan/core";
import { wallNormal } from "./geometry.js";

interface Props {
  walls: Wall[];
  pours: Pour[];
  selectedWallId: string | null;
  scale: number;
  onSelect: (wallId: string | null) => void;
}

function pourColor(pours: Pour[], pourId: string): string {
  return pours.find((p) => p.id === pourId)?.color ?? "#475569";
}

export function Walls({ walls, pours, selectedWallId, scale, onSelect }: Props) {
  return (
    <>
      {walls.map((wall) => {
        const color = pourColor(pours, wall.pourId);
        const selected = wall.id === selectedWallId;
        const [a, b]: [Point, Point] = wall.innerLine;
        // Draw the outer face as a thin ghost line offset by thickness so the
        // engineer sees the wall's real footprint, not just its centerline.
        const n = wallNormal(wall);
        const outerA = { x: a.x + n.x * wall.thickness, y: a.y + n.y * wall.thickness };
        const outerB = { x: b.x + n.x * wall.thickness, y: b.y + n.y * wall.thickness };
        return (
          <Group key={wall.id} onClick={() => onSelect(wall.id)} onTap={() => onSelect(wall.id)}>
            <Line
              points={[a.x, a.y, b.x, b.y]}
              stroke={color}
              strokeWidth={selected ? 6 / scale : 4 / scale}
              opacity={selected ? 1 : 0.9}
              hitStrokeWidth={16 / scale}
            />
            <Line
              points={[outerA.x, outerA.y, outerB.x, outerB.y]}
              stroke={color}
              strokeWidth={1.5 / scale}
              dash={[6 / scale, 4 / scale]}
              opacity={0.4}
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}
