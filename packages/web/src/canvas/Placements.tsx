import { useMemo } from "react";
import { Group, Line, Text } from "react-konva";
import type Konva from "konva";
import type { Placement, ProjectLayout, Wall } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { placementCorners, wallDirection, wallNormal } from "./geometry.js";
import { resolvedWallFrame } from "./resolvedWallFrame.js";

interface Props {
  walls: Wall[];
  placements: Placement[];
  layout: ProjectLayout | undefined;
  selectedPlacementId: string | null;
  scale: number;
  onSelect: (placementId: string | null) => void;
  onContextMenu?: (placementId: string, screenX: number, screenY: number) => void;
}

interface Colors {
  fill: string;
  stroke: string;
  text: string;
}

function colorsFor(placement: Placement): Colors {
  const isFlagged = placement.flags.some((f) => f !== "outer-corner-protrusion");
  if (isFlagged) return { fill: "#fecaca", stroke: "#b91c1c", text: "#7f1d1d" };
  if (placement.source === "manual") return { fill: "#fef3c7", stroke: "#b45309", text: "#78350f" };
  if (placement.flags.includes("outer-corner-protrusion")) return { fill: "#e0e7ff", stroke: "#4f46e5", text: "#3730a3" };
  if (placement.kind === "timber") return { fill: "#fde68a", stroke: "#a16207", text: "#713f12" };
  if (placement.kind === "corner-panel") return { fill: "#cffafe", stroke: "#0e7490", text: "#155e75" };
  // Green reads as "faces a room", blue as "faces the outside" — so a
  // partition between two rooms comes out green on both faces.
  if (!placement.faceIsInterior) return { fill: "#dbeafe", stroke: "#1d4ed8", text: "#1e3a8a" };
  return { fill: "#dcfce7", stroke: "#15803d", text: "#14532d" };
}

/** All plausible along-edge snap targets for the given placement's edge. */
function siblingSnapPoints(placement: Placement, all: Placement[]): number[] {
  const targets = new Set<number>();
  targets.add(0);
  for (const other of all) {
    if (other.edgeId !== placement.edgeId) continue;
    if (other.id === placement.id) continue;
    // Snap only against inner-face siblings to keep the visual snap points
    // aligned with what the user actually sees a joint against.
    if (other.side !== placement.side) continue;
    if (other.flags.includes("outer-corner-protrusion")) continue;
    targets.add(other.offsetAlongEdge);
    targets.add(other.offsetAlongEdge + other.width);
  }
  return [...targets];
}

function snapToTargets(offset: number, targets: number[], snapCm: number): number {
  let best = offset;
  let bestD = snapCm;
  for (const t of targets) {
    const d = Math.abs(offset - t);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function Placements({
  walls,
  placements,
  layout,
  selectedPlacementId,
  scale,
  onSelect,
  onContextMenu,
}: Props) {
  const { dispatch } = useProject();
  const wallById = useMemo(() => new Map(walls.map((w) => [w.id, w])), [walls]);
  const depth = 8; // cm of visual thickness for the band

  return (
    <>
      {placements.map((placement) => {
        const wall = wallById.get(placement.wallId);
        if (!wall) return null;

        const frame = resolvedWallFrame(wall, layout);
        // Face B sits one wall thickness out along the resolved outward
        // direction; face A sits on the centerline. Both bands then extend
        // away from the wall body so they never overlap it.
        const sideSign: 1 | -1 =
          placement.side === "faceB" ? frame.outwardSign : (-frame.outwardSign as 1 | -1);
        const baseOffset =
          placement.side === "faceB" ? frame.faceBOffsetCm * frame.outwardSign : 0;
        const dir = wallDirection(wall);
        const n = wallNormal(wall);

        const [c0, c1, c2, c3] = placementCorners(
          wall,
          placement.offsetAlongEdge,
          placement.width,
          sideSign,
          depth
        );
        const push = { x: n.x * baseOffset, y: n.y * baseOffset };
        const points = [
          c0.x + push.x, c0.y + push.y,
          c1.x + push.x, c1.y + push.y,
          c2.x + push.x, c2.y + push.y,
          c3.x + push.x, c3.y + push.y,
        ];

        const colors = colorsFor(placement);
        const selected = placement.id === selectedPlacementId;

        const [a] = wall.innerLine;
        const midOffset = placement.offsetAlongEdge + placement.width / 2;
        const labelPos = {
          x: a.x + dir.x * midOffset + (n.x * sideSign * depth) / 2 + push.x,
          y: a.y + dir.y * midOffset + (n.y * sideSign * depth) / 2 + push.y,
        };
        const angleDeg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;

        const labelText =
          placement.kind === "timber"
            ? `עץ ${Math.round(placement.width)}`
            : placement.flags.includes("outer-corner-protrusion")
              ? `+${Math.round(placement.width)}`
              : placement.panelType || `${Math.round(placement.width)}`;

        // Corner panels and outer-corner protrusions come from the corners
        // layer and don't slide along the wall — leave them non-draggable
        // to avoid users accidentally breaking corner geometry.
        const draggable =
          placement.kind === "panel" && !placement.flags.includes("outer-corner-protrusion");

        const snapTargets = draggable ? siblingSnapPoints(placement, placements) : [];

        const constrainAlongAxis = (node: Konva.Node) => {
          const rawX = node.x();
          const rawY = node.y();
          const along = rawX * dir.x + rawY * dir.y;
          // Clamp so the placement can't be dragged before nodeA — negative
          // offsets are legitimate only for corner-adjacent placements,
          // which aren't draggable.
          const minAlong = -placement.offsetAlongEdge;
          const clamped = Math.max(minAlong, along);
          // Snap the resulting offset to nearby siblings/wall start.
          const targetOffset = placement.offsetAlongEdge + clamped;
          const snapped = snapToTargets(targetOffset, snapTargets, 5);
          const finalAlong = snapped - placement.offsetAlongEdge;
          node.x(finalAlong * dir.x);
          node.y(finalAlong * dir.y);
        };

        return (
          <Group
            key={placement.id}
            draggable={draggable}
            onDragStart={(e) => {
              e.cancelBubble = true;
              onSelect(placement.id);
            }}
            onDragMove={(e) => constrainAlongAxis(e.target)}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              const node = e.target;
              const along = node.x() * dir.x + node.y() * dir.y;
              const newOffset = Math.round(placement.offsetAlongEdge + along);
              // Reset the visual translation — the reducer will re-render
              // the band at its new offsetAlongEdge in the next paint.
              node.x(0);
              node.y(0);
              if (newOffset !== placement.offsetAlongEdge) {
                dispatch({
                  type: "update-placement",
                  placementId: placement.id,
                  patch: { offsetAlongEdge: newOffset },
                });
              }
            }}
            onClick={(e) => {
              e.cancelBubble = true;
              onSelect(placement.id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onSelect(placement.id);
            }}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              onSelect(placement.id);
              if (!onContextMenu) return;
              const pos = e.target.getStage()?.getPointerPosition();
              if (pos) onContextMenu(placement.id, pos.x, pos.y);
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
            {(() => {
              // Only render the label when it can actually fit inside the
              // placement band (with a small margin) — otherwise the letters
              // spill over neighbouring panels and turn into visual noise.
              // Selected placement is always labelled so the user can see
              // what they picked, even if it's cramped.
              const fontSize = 10 / scale;
              const labelWidthCm = labelText.length * fontSize * 0.6;
              const fits = labelWidthCm < placement.width * 0.85;
              if (!selected && !fits) return null;
              return (
                <Text
                  x={labelPos.x}
                  y={labelPos.y}
                  text={labelText}
                  fontSize={fontSize}
                  fill={colors.text}
                  rotation={angleDeg}
                  offsetX={(labelText.length * 3) / scale}
                  offsetY={5 / scale}
                  listening={false}
                />
              );
            })()}
          </Group>
        );
      })}
    </>
  );
}
