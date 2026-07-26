import { Circle, Group, Line } from "react-konva";
import type Konva from "konva";
import type { Point, Pour, Wall } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { snapEndpoint, wallNormal } from "./geometry.js";

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
          const snappedA = snapEndpoint(newA, otherWalls, null, 20);
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
          </Group>
        );
      })}
    </>
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
  return (
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
        const snapped = snapEndpoint(raw, otherWalls, otherEndpoint, 20);
        e.target.x(snapped.x);
        e.target.y(snapped.y);
      }}
      onDragEnd={(e) => {
        const raw: Point = { x: e.target.x(), y: e.target.y() };
        const snapped = snapEndpoint(raw, otherWalls, otherEndpoint, 20);
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
  );
}
