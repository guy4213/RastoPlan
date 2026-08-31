import { useEffect, useMemo, useState } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { Point, Pour, ProjectLayout, Wall } from "@rastoplan/core";
import { retargetWallThickness } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { ENDPOINT_SNAP_PIXELS, applyAxisLock, findEndpointSnapTarget, formatLength, labelSideByWallId, snapEndpoint, thicknessFromPointer, wallLabelPlacement, wallNormal } from "./geometry.js";
import { MAX_WALL_THICKNESS_CM, MIN_WALL_THICKNESS_CM } from "../state/project.js";

import {
  resolvedWallFrame,
  thicknessDimensionGroupKey,
  thicknessDimensionMode,
} from "./resolvedWallFrame.js";

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

/** Drag granularity for the thickness grip. A mouse cannot hold a tenth of
 * a centimetre; the numeric field stays finer for when that matters. */
const THICKNESS_DRAG_STEP_CM = 0.5;

/** How far off its wall a length label sits, in screen pixels at any zoom. */
const LABEL_OFFSET_PIXELS = 20;

export function Walls({ walls, pours, layout, selectedWallId, selectedWallIds, scale, onSelect, onContextMenu }: Props) {
  const { state, dispatch } = useProject();
  const draggable = state.ui.tool === "select";
  const orthoLock = state.ui.orthoLock;

  // Thickness being dragged, in cm. Local rather than dispatched per pointer
  // move: a dispatch would re-run the whole pairing pass on every pixel. The
  // preview below is computed with the SAME function the commit uses, so what
  // the user drags is exactly what lands.
  const [thicknessDrag, setThicknessDrag] = useState<{
    wallId: string;
    thicknessCm: number;
  } | null>(null);
  const [thicknessTextEdit, setThicknessTextEdit] = useState<{
    wallId: string;
    draft: string;
    originalCm: number | null;
    lastAppliedCm: number | null;
    replaceOnType: boolean;
  } | null>(null);

  // Includes the partner moved to the dragged thickness AND the neighbouring
  // contour segments re-mitred onto it, so the far contour stays closed while
  // the drag is in flight instead of tearing open at the corners.
  const shownWalls = thicknessDrag
    ? retargetWallThickness(walls, thicknessDrag.wallId, thicknessDrag.thicknessCm).walls
    : walls;
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

  // Konva text is not a DOM input, so direct editing is handled as a tiny
  // canvas-native numeric field. The first digit replaces the selected value;
  // every valid draft is applied immediately, while Enter/click-away finishes
  // and Escape restores the value from before editing.
  useEffect(() => {
    if (!thicknessTextEdit) return;

    const finish = () => setThicknessTextEdit(null);
    const onPointerDown = () => finish();
    const onKeyDown = (event: KeyboardEvent) => {
      const edit = thicknessTextEdit;

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (
          edit.originalCm !== null &&
          edit.lastAppliedCm !== null &&
          Math.abs(edit.lastAppliedCm - edit.originalCm) >= 0.001
        ) {
          dispatch({ type: "update-wall", wallId: edit.wallId, patch: { thickness: edit.originalCm } });
        }
        finish();
        return;
      }

      let nextDraft: string | null = null;
      if (event.key === "Backspace" || event.key === "Delete") {
        nextDraft = edit.replaceOnType ? "" : edit.draft.slice(0, -1);
      } else if (/^[0-9]$/.test(event.key)) {
        nextDraft = edit.replaceOnType ? event.key : `${edit.draft}${event.key}`;
      } else if (event.key === "." || event.key === ",") {
        nextDraft = edit.replaceOnType ? "0." : `${edit.draft}.`;
      }

      if (nextDraft === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      // One optional decimal separator, no signs/exponents: this is a wall
      // dimension, not a generic JavaScript number field.
      if (!/^\d*(?:\.\d*)?$/.test(nextDraft)) return;
      const value = Number(nextDraft);
      const valid =
        nextDraft !== "" &&
        !nextDraft.endsWith(".") &&
        Number.isFinite(value) &&
        value >= MIN_WALL_THICKNESS_CM &&
        value <= MAX_WALL_THICKNESS_CM;

      setThicknessTextEdit({
        ...edit,
        draft: nextDraft,
        replaceOnType: false,
        lastAppliedCm: valid ? value : edit.lastAppliedCm,
      });

      if (
        valid &&
        (edit.lastAppliedCm === null || Math.abs(value - edit.lastAppliedCm) >= 0.001)
      ) {
        dispatch({ type: "update-wall", wallId: edit.wallId, patch: { thickness: value } });
      }
    };

    // Capture lets this edit finish before a different Konva label handles its
    // click and starts the next one. The opening click happens before the
    // effect is installed, so it cannot close itself immediately.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dispatch, thicknessTextEdit]);

  useEffect(() => {
    if (thicknessTextEdit && !walls.some((wall) => wall.id === thicknessTextEdit.wallId)) {
      setThicknessTextEdit(null);
    }
  }, [thicknessTextEdit, walls]);

  // Hide length labels on walls shorter than the text would need, and
  // when zoomed so far out that even a big wall looks < ~60px on screen.
  const minCmForLabel = 60 / scale;

  // Which side each length label sits on, worked out per traced ring. Not
  // frame.outwardSign: that points at the paired far contour, which on an
  // outer ring is towards the middle of the plan.
  const labelSides = useMemo(() => labelSideByWallId(walls), [walls]);
  const resolvedFramesByWallId = useMemo(
    () =>
      new Map(
        shownWalls.map((wall) => [wall.id, resolvedWallFrame(wall, layout, shownWalls)])
      ),
    [shownWalls, layout]
  );
  const colorByPourId = useMemo(
    () => new Map(pours.map((pour) => [pour.id, pour.color])),
    [pours]
  );

  const frameForWall = (wall: Wall) => {
    const resolvedFrame =
      resolvedFramesByWallId.get(wall.id) ?? resolvedWallFrame(wall, layout, shownWalls);
    const dragThickness = thicknessDrag?.wallId === wall.id ? thicknessDrag.thicknessCm : null;
    return dragThickness === null
      ? resolvedFrame
      : { ...resolvedFrame, thickness: dragThickness, faceBOffsetCm: dragThickness };
  };

  // Two opposite source contours can describe the same face-to-face gap while
  // anchoring their dimension at slightly different midpoints. Pick one owner
  // per measured gap; the primary selected wall wins so its grip remains usable.
  const thicknessOwnerByGap = new Map<string, { wallId: string; interactive: boolean }>();
  for (const wall of shownWalls) {
    const frame = frameForWall(wall);
    const mode = thicknessDimensionMode(frame, wall.id === selectedWallId, draggable);
    if (mode === "hidden") continue;
    const key = thicknessDimensionGroupKey(wall, frame);
    const current = thicknessOwnerByGap.get(key);
    const interactive = mode === "interactive";
    if (!current || (interactive && !current.interactive)) {
      thicknessOwnerByGap.set(key, { wallId: wall.id, interactive });
    }
  }

  return (
    <>
      {shownWalls.map((wall) => {
        const color = colorByPourId.get(wall.pourId) ?? "#475569";
        const isPrimary = wall.id === selectedWallId;
        const selected = selectedSet.has(wall.id) || isPrimary;
        const [a, b]: [Point, Point] = wall.innerLine;
        const n = wallNormal(wall);
        // While this wall is being dragged its own frame still carries the old
        // thickness, so frameForWall lets the dragged value win.
        const dragThickness = thicknessDrag?.wallId === wall.id ? thicknessDrag.thicknessCm : null;
        const frame = frameForWall(wall);
        const requestedThicknessMode = thicknessDimensionMode(frame, isPrimary, draggable);
        const thicknessKey = thicknessDimensionGroupKey(wall, frame);
        const thicknessMode =
          thicknessOwnerByGap.get(thicknessKey)?.wallId === wall.id
            ? requestedThicknessMode
            : "hidden";
        // Offset in the RESOLVED outward direction, not blindly along +normal:
        // on a wall drawn the other way round the far face is on the other side.
        const push = frame.faceBOffsetCm * frame.outwardSign;
        const outerA = { x: a.x + n.x * push, y: a.y + n.y * push };
        const outerB = { x: b.x + n.x * push, y: b.y + n.y * push };

        // Other walls act as endpoint-snap sources; we exclude the current
        // wall so its own endpoints don't interfere with dragging it.
        const otherWalls = isPrimary ? shownWalls.filter((w) => w.id !== wall.id) : [];

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
          const snapWalls =
            otherWalls.length > 0
              ? otherWalls
              : shownWalls.filter((candidate) => candidate.id !== wall.id);
          const snappedA = snapEndpoint(newA, snapWalls, ENDPOINT_SNAP_PIXELS / scale);
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
              {/* This face may already be drawn: a consumed wall IS its partner's
                  far face, and a paired wall's far face is the partner's own line.
                  A derived stroke here would be a second line on one face. */}
              {!frame.isConsumed && !frame.faceBIsDrawn && frame.thicknessIsSet && (
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
                  orthoLock={orthoLock}
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
                  orthoLock={orthoLock}
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
              outwardSign={labelSides.get(wall.id) ?? 1}
              scale={scale}
              units={units}
              highlight={selected}
              hidden={Math.hypot(b.x - a.x, b.y - a.y) < minCmForLabel}
              onEdit={() => onEditLength(wall)}
            />
            {/* One static thickness per physical wall stays visible. Only the
                primary selected wall gets the drag grip, so paired contours do
                not duplicate dimensions and the canvas does not fill with
                editing handles. */}
            {thicknessMode !== "hidden" && (
              <ThicknessDimension
                from={{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }}
                normal={n}
                offsetCm={push}
                color={color}
                scale={scale}
                highlight={selected || dragThickness !== null}
                draggable={thicknessMode === "interactive"}
                editingDraft={
                  thicknessTextEdit?.wallId === wall.id ? thicknessTextEdit.draft : null
                }
                onEdit={() => {
                  onSelect(wall.id);
                  const value = Math.round(frame.thickness * 10) / 10;
                  setThicknessTextEdit({
                    wallId: wall.id,
                    draft: String(value),
                    originalCm: value,
                    lastAppliedCm: value,
                    replaceOnType: true,
                  });
                }}
                onDrag={(pointer) =>
                  setThicknessDrag({
                    wallId: wall.id,
                    thicknessCm: thicknessFromPointer(wall.innerLine, frame.outwardSign, pointer, {
                      minCm: MIN_WALL_THICKNESS_CM,
                      maxCm: MAX_WALL_THICKNESS_CM,
                      stepCm: THICKNESS_DRAG_STEP_CM,
                    }),
                  })
                }
                onDragEnd={(pointer) => {
                  setThicknessDrag(null);
                  // Recomputed from the release position rather than read out
                  // of the drag state: a fast release can fire before React
                  // has flushed the last move, and committing the value from
                  // one frame earlier would quietly save the wrong thickness.
                  const thicknessCm = thicknessFromPointer(
                    wall.innerLine,
                    frame.outwardSign,
                    pointer,
                    { minCm: MIN_WALL_THICKNESS_CM, maxCm: MAX_WALL_THICKNESS_CM, stepCm: THICKNESS_DRAG_STEP_CM }
                  );
                  if (thicknessCm === wall.thickness) return;
                  dispatch({ type: "update-wall", wallId: wall.id, patch: { thickness: thicknessCm } });
                }}
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

/**
 * A dimension line spanning the wall's two faces, with the thickness on it.
 *
 * Wall thickness is exactly this distance, and it is the number the whole BOM
 * is sized from — but until now it only existed inside a side panel, one wall
 * at a time. Drawing it where it is measured is what lets the engineer check a
 * plan at a glance instead of clicking through every wall.
 */
function ThicknessDimension({
  from,
  normal,
  offsetCm,
  color,
  scale,
  highlight,
  draggable,
  editingDraft,
  onEdit,
  onDrag,
  onDragEnd,
}: {
  from: Point;
  normal: Point;
  offsetCm: number;
  color: string;
  scale: number;
  highlight: boolean;
  draggable: boolean;
  editingDraft: string | null;
  onEdit: () => void;
  onDrag: (pointer: Point) => void;
  onDragEnd: (pointer: Point) => void;
}) {
  const thickness = Math.abs(offsetCm);
  const to = { x: from.x + normal.x * offsetCm, y: from.y + normal.y * offsetCm };

  // Radius in screen pixels, so it stays the same size to grab at any zoom.
  const grip = draggable ? (
    <Circle
      x={to.x}
      y={to.y}
      radius={5 / scale}
      fill="#fff"
      stroke={color}
      strokeWidth={2 / scale}
      draggable
      onMouseEnter={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "ns-resize";
      }}
      onMouseLeave={(e) => {
        const stage = e.target.getStage();
        if (stage) stage.container().style.cursor = "";
      }}
      onDragStart={(e) => {
        // Otherwise the wall underneath starts its own whole-wall drag too.
        e.cancelBubble = true;
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const pointer = e.target.getStage()?.getRelativePointerPosition();
        if (pointer) onDrag(pointer);
        // The grip is positioned from state, not from its own node: letting
        // Konva keep the dragged position would fight the clamping and let it
        // drift off the dimension line.
        e.target.position(to);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        e.target.position(to);
        const pointer = e.target.getStage()?.getRelativePointerPosition();
        if (pointer) onDragEnd(pointer);
      }}
    />
  ) : null;

  const tick = { x: -normal.y, y: normal.x };
  const tickCm = 5 / scale;
  const label = Number.isInteger(thickness) ? String(thickness) : thickness.toFixed(1);
  const labelText = `${label} ס"מ`;
  const shownLabelText = `${editingDraft ?? label}${labelText.slice(label.length)}`;
  const labelX = (from.x + to.x) / 2 + tick.x * tickCm;
  const labelY = (from.y + to.y) / 2 + tick.y * tickCm;
  const editWidth = Math.max(42, shownLabelText.length * 5.6) / scale;
  const editHeight = 18 / scale;

  return (
    <Group opacity={highlight ? 1 : 0.65}>
      <Line
        points={[from.x, from.y, to.x, to.y]}
        stroke={color}
        strokeWidth={1 / scale}
        listening={false}
      />
      {[from, to].map((p, i) => (
        <Line
          key={i}
          points={[
            p.x - tick.x * tickCm,
            p.y - tick.y * tickCm,
            p.x + tick.x * tickCm,
            p.y + tick.y * tickCm,
          ]}
          stroke={color}
          strokeWidth={1 / scale}
          listening={false}
        />
      ))}
      {editingDraft !== null && (
        <Rect
          x={labelX - editWidth / 2}
          y={labelY - editHeight / 2}
          width={editWidth}
          height={editHeight}
          fill="#ffffff"
          stroke={color}
          strokeWidth={1.5 / scale}
          cornerRadius={3 / scale}
          listening={false}
        />
      )}
      <Text
        x={labelX}
        y={labelY}
        text={shownLabelText}
        fontSize={10 / scale}
        fontStyle={editingDraft !== null ? "bold" : "normal"}
        fill={color}
        offsetX={(shownLabelText.length * 10 * 0.28) / scale}
        offsetY={5 / scale}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "text";
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "";
        }}
        onClick={(e) => {
          e.cancelBubble = true;
          onEdit();
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          onEdit();
        }}
      />
      {grip}
    </Group>
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
  const lengthCm = Math.hypot(b.x - a.x, b.y - a.y);
  // A fixed distance on screen, and deliberately nothing to do with the wall's
  // thickness. It used to clear the thickness first, which reads fine on a 20cm
  // wall and falls apart on anything else: where the engine resolved two traced
  // rings as one 95cm wall, every label was flung 100cm out, over the next ring
  // and on top of its labels. They had not disappeared — they were stacked.
  const placement = wallLabelPlacement(wall, outwardSign, LABEL_OFFSET_PIXELS / scale);
  if (!placement) return null;

  const text = formatLength(lengthCm, units);
  const fontSize = 12 / scale;
  return (
    <Text
      x={placement.x}
      y={placement.y}
      text={text}
      fontSize={fontSize}
      fill={highlight ? "#0f172a" : "#334155"}
      fontStyle={highlight ? "bold" : "normal"}
      rotation={placement.rotationDeg}
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
  orthoLock,
  otherWalls,
  otherEndpoint,
  onCommit,
}: {
  point: Point;
  scale: number;
  orthoLock: boolean;
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
          const locked = applyAxisLock(otherEndpoint, snapped, orthoLock);
          e.target.x(locked.x);
          e.target.y(locked.y);
          setSnapTarget(findEndpointSnapTarget(raw, otherWalls, snapCm));
        }}
        onDragEnd={(e) => {
          const raw: Point = { x: e.target.x(), y: e.target.y() };
          const snapped = snapEndpoint(raw, otherWalls, snapCm);
          const locked = applyAxisLock(otherEndpoint, snapped, orthoLock);
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
