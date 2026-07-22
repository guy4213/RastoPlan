import { Group, Line, Rect, Text } from "react-konva";
import type { Placement, Wall } from "@rastoplan/core";
import { placementCorners, wallDirection, wallNormal } from "./geometry.js";

interface Props {
  walls: Wall[];
  placements: Placement[];
  selectedPlacementId: string | null;
  scale: number;
  onSelect: (placementId: string | null) => void;
}

interface Colors {
  fill: string;
  stroke: string;
  text: string;
}

function colorsFor(placement: Placement): Colors {
  // Flagged placements dominate — the engineer must SEE the failure before
  // caring whether it's an inner or outer face.
  const isFlagged = placement.flags.some((f) => f !== "outer-corner-protrusion");
  if (isFlagged) return { fill: "#fecaca", stroke: "#b91c1c", text: "#7f1d1d" };

  if (placement.source === "manual") {
    return { fill: "#fef3c7", stroke: "#b45309", text: "#78350f" };
  }
  if (placement.flags.includes("outer-corner-protrusion")) {
    return { fill: "#e0e7ff", stroke: "#4f46e5", text: "#3730a3" };
  }
  if (placement.kind === "timber") return { fill: "#fde68a", stroke: "#a16207", text: "#713f12" };
  if (placement.kind === "corner-panel") return { fill: "#cffafe", stroke: "#0e7490", text: "#155e75" };
  if (placement.side === "outer") return { fill: "#dbeafe", stroke: "#1d4ed8", text: "#1e3a8a" };
  return { fill: "#dcfce7", stroke: "#15803d", text: "#14532d" };
}

/**
 * Renders each Placement as a small band next to its wall. The band's
 * `side` decides which perpendicular direction to draw on. Inside the
 * band we show a label (panel type or "עץ" for timber, dimension in cm).
 */
export function Placements({ walls, placements, selectedPlacementId, scale, onSelect }: Props) {
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const depth = 8; // cm of visual thickness for the band

  return (
    <>
      {placements.map((placement) => {
        const wall = wallById.get(placement.edgeId.replace(/^edge:/, ""));
        if (!wall) return null;
        // Inner face draws on -normal (toward interior), outer on +normal —
        // this matches deriveOuterLine's convention.
        const sideSign: 1 | -1 = placement.side === "outer" ? 1 : -1;
        // For outer face, place OUTSIDE the outer line (further from inner).
        const baseOffset = placement.side === "outer" ? wall.thickness : 0;

        const [c0, c1, c2, c3] = placementCorners(
          wall,
          placement.offsetAlongEdge,
          placement.width,
          sideSign,
          depth
        );
        // Push the whole rect out by baseOffset in the +normal direction so
        // outer-face bands don't overlap the inner-face bands.
        const n = wallNormal(wall);
        const push = { x: n.x * baseOffset, y: n.y * baseOffset };
        const points = [
          c0.x + push.x, c0.y + push.y,
          c1.x + push.x, c1.y + push.y,
          c2.x + push.x, c2.y + push.y,
          c3.x + push.x, c3.y + push.y,
        ];

        const colors = colorsFor(placement);
        const selected = placement.id === selectedPlacementId;

        // Label at the band's center, oriented along the wall's direction.
        const dir = wallDirection(wall);
        const midOffset = placement.offsetAlongEdge + placement.width / 2;
        const [a] = wall.innerLine;
        const labelPos = {
          x: a.x + dir.x * midOffset + n.x * (sideSign * depth) / 2 + push.x,
          y: a.y + dir.y * midOffset + n.y * (sideSign * depth) / 2 + push.y,
        };
        const angleRad = Math.atan2(dir.y, dir.x);
        const angleDeg = (angleRad * 180) / Math.PI;

        const labelText =
          placement.kind === "timber"
            ? `עץ ${Math.round(placement.width)}`
            : placement.flags.includes("outer-corner-protrusion")
              ? `+${Math.round(placement.width)}`
              : placement.panelType || `${Math.round(placement.width)}`;

        return (
          <Group
            key={placement.id}
            onClick={(e) => {
              e.cancelBubble = true;
              onSelect(placement.id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onSelect(placement.id);
            }}
          >
            <Line
              points={points}
              closed
              fill={colors.fill}
              stroke={selected ? "#000" : colors.stroke}
              strokeWidth={(selected ? 2 : 1) / scale}
              opacity={0.92}
            />
            <Text
              x={labelPos.x}
              y={labelPos.y}
              text={labelText}
              fontSize={10 / scale}
              fill={colors.text}
              rotation={angleDeg}
              offsetX={(labelText.length * 3) / scale}
              offsetY={5 / scale}
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}

/** Small drag handle for the currently-selected placement. */
export function DragHandle({
  placement,
  wall,
  scale,
  onDragEnd,
}: {
  placement: Placement;
  wall: Wall;
  scale: number;
  onDragEnd: (newOffset: number) => void;
}) {
  const dir = wallDirection(wall);
  const n = wallNormal(wall);
  const sideSign: 1 | -1 = placement.side === "outer" ? 1 : -1;
  const baseOffset = placement.side === "outer" ? wall.thickness + 8 : -8;
  const [a] = wall.innerLine;
  const mid = placement.offsetAlongEdge + placement.width / 2;
  const pos = {
    x: a.x + dir.x * mid + n.x * (sideSign * 8) + n.x * baseOffset,
    y: a.y + dir.y * mid + n.y * (sideSign * 8) + n.y * baseOffset,
  };
  return (
    <Rect
      x={pos.x - 5 / scale}
      y={pos.y - 5 / scale}
      width={10 / scale}
      height={10 / scale}
      fill="#000"
      draggable
      onDragEnd={(e) => {
        // Project drag delta back onto the wall direction to get new offset.
        const newX = e.target.x() + 5 / scale;
        const newY = e.target.y() + 5 / scale;
        const dx = newX - (a.x + n.x * baseOffset + n.x * (sideSign * 8));
        const dy = newY - (a.y + n.y * baseOffset + n.y * (sideSign * 8));
        const along = dx * dir.x + dy * dir.y;
        const newOffset = Math.max(0, Math.round(along - placement.width / 2));
        onDragEnd(newOffset);
      }}
    />
  );
}
