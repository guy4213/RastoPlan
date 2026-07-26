import { useState } from "react";
import { Circle, Group, Line, Text } from "react-konva";
import type Konva from "konva";
import type { Point, Pour, Wall } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { ENDPOINT_SNAP_PIXELS, findEndpointSnapTarget, formatLength, snapEndpoint, wallNormal } from "./geometry.js";

interface Props {
  walls: Wall[];
  pours: Pour[];
  selectedWallId: string | null;
  selectedWallIds: string[];
  scale: number;
  onSelect: (wallId: string | null) => void;
  onContextMenu?: (wallId: string, screenX: number, screenY: number) => void;
}

function pourColor(pours: Pour[], pourId: string): string {
  return pours.find((p) => p.id === pourId)?.color ?? "#475569";
}

export function Walls({ walls, pours, selectedWallId, selectedWallIds, scale, onSelect, onContextMenu }: Props) {
  const { state, dispatch } = useProject();
  const draggable = state.ui.tool === "select";
  const selectedSet = new Set(selectedWallIds);
  const units = state.ui.units;
  // Hide length labels on walls shorter than the text would need, and
  // when zoomed so far out that even a big wall looks < ~60px on screen.
  const minCmForLabel = 60 / scale;

  return (
    <>
      {walls.map((wall) => {
        const color = pourColor(pours, wall.pourId);
        const isPrimary = wall.id === selectedWallId;
        const selected = selectedSet.has(wall.id) || isPrimary;
        const [a, b]: [Point, Point] = wall.innerLine;
        const n = wallNormal(wall);
        const outerA = { x: a.x + n.x * wall.thickness, y: a.y + n.y * wall.thickness };
        const outerB = { x: b.x + n.x * wall.thickness, y: b.y + n.y * wall.thickness };

        // Other walls act as endpoint-snap sources; we exclude the current
        // wall so its own endpoints don't interfere with dragging it.
        const otherWalls = walls.filter((w) => w.id !== wall.id);

        const commitWholeWallMove = (node: Konva.Node) => {
          const dx = node.x();
          const dy = node.y();
          node.x(0);
          node.y(0);
          if (dx === 0 && dy === 0) return;
          const newA: Point = { x: Math.round(a.x + dx), y: Math.round(a.y + dy) };
          const newB: Point = { x: Math.round(b.x + dx), y: Math.round(b.y + dy) };
          // Endpoint-snap the whole-wall translation to nearby corners of
          // other walls (so the moved wall lands cleanly on an existing
          // junction if the user releases near one).
          const snappedA = snapEndpoint(newA, otherWalls, null, ENDPOINT_SNAP_PIXELS / scale);
          const deltaAfterSnapA = { x: snappedA.x - newA.x, y: snappedA.y - newA.y };
          const finalA = snappedA;
          const finalB = { x: newB.x + deltaAfterSnapA.x, y: newB.y + deltaAfterSnapA.y };
          dispatch({ type: "update-wall", wallId: wall.id, patch: { innerLine: [finalA, finalB] } });
        };

        return (
          <Group key={wall.id}>
            <Group
              draggable={draggable}
              onClick={(e) => {
                e.cancelBubble = true;
                onSelect(wall.id);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                onSelect(wall.id);
              }}
              onDragStart={(e) => {
                e.cancelBubble = true;
                onSelect(wall.id);
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
                commitWholeWallMove(e.target);
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault();
                e.cancelBubble = true;
                onSelect(wall.id);
                if (!onContextMenu) return;
                const pos = e.target.getStage()?.getPointerPosition();
                if (pos) onContextMenu(wall.id, pos.x, pos.y);
              }}
            >
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

            {isPrimary && draggable && (
              <>
                <EndpointHandle
                  point={a}
                  scale={scale}
                  otherWalls={otherWalls}
                  otherEndpoint={b}
                  onCommit={(p) => {
                    dispatch({
                      type: "update-wall",
                      wallId: wall.id,
                      patch: { innerLine: [p, b] },
                    });
                  }}
                />
                <EndpointHandle
                  point={b}
                  scale={scale}
                  otherWalls={otherWalls}
                  otherEndpoint={a}
                  onCommit={(p) => {
                    dispatch({
                      type: "update-wall",
                      wallId: wall.id,
                      patch: { innerLine: [a, p] },
                    });
                  }}
                />
              </>
            )}
            <WallLengthLabel
              wall={wall}
              scale={scale}
              units={units}
              highlight={selected}
              hidden={Math.hypot(b.x - a.x, b.y - a.y) < minCmForLabel}
            />
          </Group>
        );
      })}
    </>
  );
}

/**
 * Length text centred on the wall, offset onto the outer side by the
 * wall's normal so it doesn't clip the stroke. Rotated to match the
 * wall's angle so long labels stay readable at any orientation.
 */
function WallLengthLabel({
  wall,
  scale,
  units,
  highlight,
  hidden,
}: {
  wall: Wall;
  scale: number;
  units: "cm" | "m";
  highlight: boolean;
  hidden: boolean;
}) {
  if (hidden) return null;
  const [a, b] = wall.innerLine;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthCm = Math.hypot(dx, dy);
  if (lengthCm < 1) return null;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const nx = dy / lengthCm;
  const ny = -dx / lengthCm;
  // Push the label onto the outer (positive normal) side, past the
  // outer-face dashed line, so it sits in the free space.
  const push = wall.thickness + 12 / scale;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Keep text upright — if the wall points to the left half, flip so
  // the text isn't read upside-down.
  const flip = angleDeg > 90 || angleDeg < -90;
  const finalAngle = flip ? angleDeg + 180 : angleDeg;
  const finalPush = flip ? -push : push;
  const text = formatLength(lengthCm, units);
  const fontSize = 12 / scale;
  return (
    <Text
      x={midX + nx * finalPush}
      y={midY + ny * finalPush}
      text={text}
      fontSize={fontSize}
      fill={highlight ? "#0f172a" : "#334155"}
      fontStyle={highlight ? "bold" : "normal"}
      rotation={finalAngle}
      offsetX={(text.length * fontSize * 0.28)}
      offsetY={fontSize / 2}
      listening={false}
    />
  );
}

function EndpointHandle({
  point,
  scale,
  otherWalls,
  otherEndpoint,
  onCommit,
}: {
  point: Point;
  scale: number;
  otherWalls: Wall[];
  otherEndpoint: Point;
  onCommit: (p: Point) => void;
}) {
  const [snapTarget, setSnapTarget] = useState<Point | null>(null);
  const snapCm = ENDPOINT_SNAP_PIXELS / scale;
  return (
    <>
      <Circle
        x={point.x}
        y={point.y}
        radius={6 / scale}
        fill="#fff"
        stroke="#0f172a"
        strokeWidth={1.5 / scale}
        draggable
        onDragMove={(e) => {
          // Snap the endpoint during drag so the user sees where it will
          // land — right-angle snap uses the other endpoint as origin, and
          // corner snap picks up nearby endpoints from other walls.
          const raw: Point = { x: e.target.x(), y: e.target.y() };
          const snapped = snapEndpoint(raw, otherWalls, otherEndpoint, snapCm);
          e.target.x(snapped.x);
          e.target.y(snapped.y);
          setSnapTarget(findEndpointSnapTarget(raw, otherWalls, snapCm));
        }}
        onDragEnd={(e) => {
          const raw: Point = { x: e.target.x(), y: e.target.y() };
          const snapped = snapEndpoint(raw, otherWalls, otherEndpoint, snapCm);
          setSnapTarget(null);
          onCommit({ x: Math.round(snapped.x), y: Math.round(snapped.y) });
        }}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "grab";
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "";
        }}
      />
      {snapTarget && (
        <Circle
          x={snapTarget.x}
          y={snapTarget.y}
          radius={8 / scale}
          stroke="#f59e0b"
          strokeWidth={2 / scale}
          fill="rgba(245, 158, 11, 0.25)"
          listening={false}
        />
      )}
    </>
  );
}
