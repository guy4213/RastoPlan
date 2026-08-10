import { useState } from "react";
import { Circle, Group, Line, Text } from "react-konva";
import type Konva from "konva";
import type { Point, Pour, ProjectLayout, Wall } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { ENDPOINT_SNAP_PIXELS, applyAxisLock, findEndpointSnapTarget, formatLength, snapEndpoint, wallNormal } from "./geometry.js";
import { resolvedWallFrame } from "./resolvedWallFrame.js";

interface Props {
  walls: Wall[];
  pours: Pour[];
  layout: ProjectLayout | undefined;
  selectedWallId: string | null;
  selectedWallIds: string[];
  scale: number;
  onSelect: (wallId: string | null) => void;
  onContextMenu?: (wallId: string, screenX: number, screenY: number) => void;
}

function pourColor(pours: Pour[], pourId: string): string {
  return pours.find((p) => p.id === pourId)?.color ?? "#475569";
}

export function Walls({ walls, pours, layout, selectedWallId, selectedWallIds, scale, onSelect, onContextMenu }: Props) {
  const { state, dispatch } = useProject();
  const draggable = state.ui.tool === "select";
  const selectedSet = new Set(selectedWallIds);
  const units = state.ui.units;

  /**
   * Retype a wall's length. Endpoint A stays put and B slides along the wall's
   * own direction, so the wall keeps its angle and its corner with whatever
   * meets it at A.
   */
  function onEditLength(wall: Wall) {
    const [a, b] = wall.innerLine;
    const current = Math.hypot(b.x - a.x, b.y - a.y);
    if (current < 1) return;

    const shown = units === "m" ? (current / 100).toFixed(2) : String(Math.round(current));
    const entered = window.prompt(
      units === "m" ? 'אורך הקיר (מ׳)' : 'אורך הקיר (ס"מ)',
      shown
    );
    if (entered === null) return;

    const parsed = Number(entered.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const targetCm = Math.round(units === "m" ? parsed * 100 : parsed);

    const ux = (b.x - a.x) / current;
    const uy = (b.y - a.y) / current;
    dispatch({
      type: "update-wall",
      wallId: wall.id,
      patch: {
        innerLine: [a, { x: Math.round(a.x + ux * targetCm), y: Math.round(a.y + uy * targetCm) }],
      },
    });
  }
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
        const frame = resolvedWallFrame(wall, layout);
        // Offset in the RESOLVED outward direction, not blindly along +normal:
        // on a wall drawn the other way round the far face is on the other side.
        const push = frame.faceBOffsetCm * frame.outwardSign;
        const outerA = { x: a.x + n.x * push, y: a.y + n.y * push };
        const outerB = { x: b.x + n.x * push, y: b.y + n.y * push };

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
          const snappedA = snapEndpoint(newA, otherWalls, ENDPOINT_SNAP_PIXELS / scale);
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
                opacity={frame.isConsumed ? 0.45 : selected ? 1 : 0.9}
                dash={frame.isConsumed ? [10 / scale, 6 / scale] : undefined}
                hitStrokeWidth={16 / scale}
              />
              {/* A consumed wall IS the far face of its partner — drawing a
                  second face for it would double the line already there. */}
              {!frame.isConsumed && (
                <Line
                  points={[outerA.x, outerA.y, outerB.x, outerB.y]}
                  stroke={color}
                  strokeWidth={1.5 / scale}
                  dash={[6 / scale, 4 / scale]}
                  opacity={0.4}
                  listening={false}
                />
              )}
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
              outwardSign={frame.outwardSign}
              scale={scale}
              units={units}
              highlight={selected}
              hidden={Math.hypot(b.x - a.x, b.y - a.y) < minCmForLabel}
              onEdit={() => onEditLength(wall)}
            />
          </Group>
        );
      })}
    </>
  );
}

/**
 * Length text centred on the wall, pushed onto the OUTSIDE by the resolved
 * outward direction so it lands in free space instead of inside the room.
 * Rotated to match the wall's angle so long labels stay readable.
 */
function WallLengthLabel({
  wall,
  outwardSign,
  scale,
  units,
  highlight,
  hidden,
  onEdit,
}: {
  wall: Wall;
  outwardSign: 1 | -1;
  scale: number;
  units: "cm" | "m";
  highlight: boolean;
  hidden: boolean;
  onEdit: () => void;
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
  const push = (wall.thickness + 12 / scale) * outwardSign;
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
      // Clicking the dimension is how you set an exact length — dragging an
      // endpoint can only ever land on whole pixels.
      onClick={(e) => {
        e.cancelBubble = true;
        onEdit();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onEdit();
      }}
      onMouseEnter={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "text";
      }}
      onMouseLeave={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "default";
      }}
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
          // Endpoint snap picks up nearby corners of other walls; Shift
          // additionally locks the drag to the wall's dominant axis using
          // the opposite endpoint as origin (the CAD "ortho" convention).
          const raw: Point = { x: e.target.x(), y: e.target.y() };
          const snapped = snapEndpoint(raw, otherWalls, snapCm);
          const locked = applyAxisLock(otherEndpoint, snapped, e.evt.shiftKey);
          e.target.x(locked.x);
          e.target.y(locked.y);
          setSnapTarget(findEndpointSnapTarget(raw, otherWalls, snapCm));
        }}
        onDragEnd={(e) => {
          const raw: Point = { x: e.target.x(), y: e.target.y() };
          const snapped = snapEndpoint(raw, otherWalls, snapCm);
          const locked = applyAxisLock(otherEndpoint, snapped, e.evt.shiftKey);
          setSnapTarget(null);
          onCommit({ x: Math.round(locked.x), y: Math.round(locked.y) });
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
