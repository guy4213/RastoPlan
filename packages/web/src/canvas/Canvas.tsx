import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import type { Point } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { Grid } from "./Grid.js";
import { Walls } from "./Walls.js";
import { Placements } from "./Placements.js";
import { WeldOverlay } from "./WeldOverlay.js";
import { ENDPOINT_SNAP_PIXELS, findEndpointSnapTarget, snapEndpoint } from "./geometry.js";

const MIN_SCALE = 0.05;
const MAX_SCALE = 5;

/**
 * If Shift is held, collapse the drag to the dominant axis so the wall is
 * strictly horizontal or vertical relative to the start point — the CAD
 * "ortho" lock users expect. Passthrough otherwise.
 */
function applyAxisLock(start: Point, end: Point, shiftKey: boolean): Point {
  if (!shiftKey) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: end.x, y: start.y };
  return { x: start.x, y: end.y };
}

interface MarqueeRect { x0: number; y0: number; x1: number; y1: number }

function normalizeRect(r: MarqueeRect): MarqueeRect {
  return {
    x0: Math.min(r.x0, r.x1),
    y0: Math.min(r.y0, r.y1),
    x1: Math.max(r.x0, r.x1),
    y1: Math.max(r.y0, r.y1),
  };
}

/**
 * Cohen–Sutherland-style crossing test — enough resolution for a marquee
 * hit test where over-selection at pixel-scale corner cases is acceptable.
 * Any wall that has an endpoint inside the rect, or whose endpoints
 * straddle any two orthogonal half-planes, is treated as intersecting.
 */
function segmentIntersectsRect(a: Point, b: Point, r: MarqueeRect): boolean {
  const outcode = (p: Point) => {
    let c = 0;
    if (p.x < r.x0) c |= 1;
    if (p.x > r.x1) c |= 2;
    if (p.y < r.y0) c |= 4;
    if (p.y > r.y1) c |= 8;
    return c;
  };
  const ca = outcode(a);
  const cb = outcode(b);
  if ((ca | cb) === 0) return true;
  if ((ca & cb) !== 0) return false;
  return true;
}

interface Size {
  width: number;
  height: number;
}

function useSize(ref: React.RefObject<HTMLDivElement>): Size {
  const [size, setSize] = useState<Size>({ width: 800, height: 600 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const observer = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function Canvas() {
  const { state, dispatch } = useProject();
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useSize(containerRef);
  const { view, tool, selectedWallId, selectedWallIds, selectedPlacementId } = state.ui;
  const { walls, pours, placements } = state.project;

  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawEnd, setDrawEnd] = useState<Point | null>(null);
  // 'dragging' = mouse held after mousedown; 'awaiting-second' = first click
  // placed, waiting for a second click to commit; 'idle' otherwise.
  const [drawMode, setDrawMode] = useState<"idle" | "dragging" | "awaiting-second">("idle");
  const mouseDownPixelRef = useRef<{ x: number; y: number } | null>(null);
  type ContextMenuState =
    | { screenX: number; screenY: number; kind: "wall"; wallId: string }
    | { screenX: number; screenY: number; kind: "placement"; placementId: string };
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Marquee (crossing window) in world coords; while active, the stage
  // must not pan or the rect will drift out from under the cursor.
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  // Vertex the next endpoint would snap to — rendered as a highlighted
  // circle so the user sees the lock happening before releasing.
  const [snapHint, setSnapHint] = useState<Point | null>(null);

  const snapCm = ENDPOINT_SNAP_PIXELS / view.scale;

  const stageToWorld = useCallback(
    (stageX: number, stageY: number): Point => ({
      x: (stageX - view.offset.x) / view.scale,
      y: (stageY - view.offset.y) / view.scale,
    }),
    [view]
  );

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
      const world = stageToWorld(pointer.x, pointer.y);
      // Zoom around the pointer: keep the world point under the cursor fixed.
      const newOffset = {
        x: pointer.x - world.x * newScale,
        y: pointer.y - world.y * newScale,
      };
      dispatch({ type: "set-view", view: { scale: newScale, offset: newOffset } });
    },
    [view.scale, stageToWorld, dispatch]
  );

  const commitWall = useCallback(
    (start: Point, end: Point) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      // Suppress micro-walls (tap or accidental release with no movement).
      if (Math.hypot(dx, dy) < 10) return;
      dispatch({
        type: "add-wall",
        a: { x: Math.round(start.x), y: Math.round(start.y) },
        b: { x: Math.round(end.x), y: Math.round(end.y) },
      });
    },
    [dispatch]
  );

  const cancelDraw = useCallback(() => {
    setDrawStart(null);
    setDrawEnd(null);
    setDrawMode("idle");
    setSnapHint(null);
    mouseDownPixelRef.current = null;
  }, []);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer || !stage) return;

      // Shift + left-drag on empty stage = marquee. Disable stage pan so the
      // rectangle stays anchored while we drag it out.
      if (
        tool === "select" &&
        e.target === stage &&
        e.evt.button === 0 &&
        e.evt.shiftKey
      ) {
        stage.draggable(false);
        const world = stageToWorld(pointer.x, pointer.y);
        setMarquee({ x0: world.x, y0: world.y, x1: world.x, y1: world.y });
        return;
      }

      if (tool !== "draw-wall") return;
      if (e.evt.button !== 0) return;
      const world = stageToWorld(pointer.x, pointer.y);

      // Second click of a click-click draw commits the wall.
      if (drawMode === "awaiting-second" && drawStart) {
        const end = applyAxisLock(drawStart, snapEndpoint(world, walls, drawStart, snapCm), e.evt.shiftKey);
        commitWall(drawStart, end);
        cancelDraw();
        return;
      }

      const snapped = snapEndpoint(world, walls, null, snapCm);
      setDrawStart(snapped);
      setDrawEnd(snapped);
      setDrawMode("dragging");
      setSnapHint(findEndpointSnapTarget(world, walls, snapCm));
      mouseDownPixelRef.current = { x: pointer.x, y: pointer.y };
    },
    [tool, walls, stageToWorld, drawMode, drawStart, commitWall, cancelDraw, snapCm]
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;

      if (marquee) {
        const world = stageToWorld(pointer.x, pointer.y);
        setMarquee({ ...marquee, x1: world.x, y1: world.y });
        return;
      }

      if (tool !== "draw-wall" || !drawStart) return;
      const world = stageToWorld(pointer.x, pointer.y);
      const snapped = snapEndpoint(world, walls, drawStart, snapCm);
      setDrawEnd(applyAxisLock(drawStart, snapped, e.evt.shiftKey));
      setSnapHint(findEndpointSnapTarget(world, walls, snapCm));
    },
    [tool, drawStart, walls, stageToWorld, marquee, snapCm]
  );

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stageObj = e.target.getStage();
      if (marquee) {
        const rect = normalizeRect(marquee);
        const hits = walls
          .filter((w) => segmentIntersectsRect(w.innerLine[0], w.innerLine[1], rect))
          .map((w) => w.id);
        dispatch({ type: "set-selected-walls", wallIds: hits });
        setMarquee(null);
        // Re-arm stage pan for subsequent plain drags.
        if (stageObj) stageObj.draggable(tool === "select");
        return;
      }

      if (tool !== "draw-wall") return;
      if (drawMode !== "dragging" || !drawStart || !drawEnd) return;

      // Distinguish click from drag by how far the pointer moved in screen
      // pixels between mousedown and mouseup. A near-stationary release
      // enters click-click mode; a real drag commits immediately.
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      const downPx = mouseDownPixelRef.current;
      const movedPx =
        pointer && downPx ? Math.hypot(pointer.x - downPx.x, pointer.y - downPx.y) : 0;
      const CLICK_PIXEL_THRESHOLD = 5;

      if (movedPx < CLICK_PIXEL_THRESHOLD) {
        setDrawMode("awaiting-second");
        mouseDownPixelRef.current = null;
        return;
      }

      commitWall(drawStart, applyAxisLock(drawStart, drawEnd, e.evt.shiftKey));
      cancelDraw();
    },
    [tool, drawMode, drawStart, drawEnd, commitWall, cancelDraw, marquee, walls, dispatch]
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Any click closes the floating context menu, wherever it landed.
      if (contextMenu) setContextMenu(null);
      // Clicking blank stage clears selection (Konva sets target to Stage).
      if (e.target === e.target.getStage() && tool === "select") {
        dispatch({ type: "select-wall", wallId: null });
      }
    },
    [dispatch, tool, contextMenu]
  );

  const handleContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      // Right-click cancels an in-progress draw; also suppress the browser
      // context menu inside the canvas so the gesture is unambiguous.
      // Walls/Placements set cancelBubble to keep their own menus visible.
      e.evt.preventDefault();
      if (tool === "draw-wall" && (drawStart || drawMode !== "idle")) {
        cancelDraw();
      }
      if (marquee) {
        setMarquee(null);
        e.target.getStage()?.draggable(tool === "select");
      }
      if (e.target === e.target.getStage()) setContextMenu(null);
    },
    [tool, drawStart, drawMode, cancelDraw, marquee]
  );

  // Keyboard: tool switch (V/D/W), Delete selection, Escape cancels.
  // Skip when the user is typing into a form field so the shortcuts
  // don't hijack, e.g., the project-name input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isEditable) return;

      if (e.key === "Escape") {
        if (contextMenu) setContextMenu(null);
        if (marquee) setMarquee(null);
        if (drawStart || drawMode !== "idle") cancelDraw();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "v") {
          dispatch({ type: "set-tool", tool: "select" });
          return;
        }
        if (k === "d") {
          dispatch({ type: "set-tool", tool: "draw-wall" });
          return;
        }
        if (k === "w") {
          dispatch({ type: "set-tool", tool: "weld" });
          return;
        }
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedWallIds.length > 1) {
        dispatch({ type: "delete-walls", wallIds: selectedWallIds });
      } else if (selectedWallId) {
        dispatch({ type: "delete-wall", wallId: selectedWallId });
      } else if (selectedPlacementId) {
        dispatch({ type: "delete-placement", placementId: selectedPlacementId });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedWallId,
    selectedWallIds,
    selectedPlacementId,
    dispatch,
    drawStart,
    drawMode,
    cancelDraw,
    contextMenu,
    marquee,
  ]);

  // Switching tools (or otherwise leaving draw-wall) must reset draw state
  // so a stale start point doesn't survive into the next tool session.
  useEffect(() => {
    if (tool !== "draw-wall") cancelDraw();
  }, [tool, cancelDraw]);

  const cursor =
    tool === "draw-wall" ? "crosshair" : tool === "weld" ? "cell" : "default";

  return (
    <div ref={containerRef} style={{ flex: 1, background: "#f8fafc", position: "relative", cursor }}>
      <Stage
        width={size.width}
        height={size.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleStageClick}
        onContextMenu={handleContextMenu}
        draggable={tool === "select"}
        x={view.offset.x}
        y={view.offset.y}
        scaleX={view.scale}
        scaleY={view.scale}
        onDragEnd={(e) => {
          // react-konva propagates drag events; e.target for a descendant
          // drag (e.g. a wall endpoint handle) would be that node, and its
          // local x/y would get written into the pan offset — teleporting
          // the viewport. Only accept the Stage's own drag.
          const stage = e.target.getStage();
          if (e.target !== stage || !stage) return;
          dispatch({
            type: "set-view",
            view: { scale: view.scale, offset: { x: stage.x(), y: stage.y() } },
          });
        }}
      >
        <Layer listening={false}>
          <Grid
            widthPx={size.width}
            heightPx={size.height}
            scale={view.scale}
            offsetX={view.offset.x}
            offsetY={view.offset.y}
          />
        </Layer>
        <Layer>
          <Walls
            walls={walls}
            pours={pours}
            selectedWallId={selectedWallId}
            selectedWallIds={selectedWallIds}
            scale={view.scale}
            onSelect={(id) => dispatch({ type: "select-wall", wallId: id })}
            onContextMenu={(id, x, y) =>
              setContextMenu({ kind: "wall", wallId: id, screenX: x, screenY: y })
            }
          />
          <Placements
            walls={walls}
            placements={placements}
            selectedPlacementId={selectedPlacementId}
            scale={view.scale}
            onSelect={(id) => dispatch({ type: "select-placement", placementId: id })}
            onContextMenu={(id, x, y) =>
              setContextMenu({ kind: "placement", placementId: id, screenX: x, screenY: y })
            }
          />
          {marquee && (() => {
            const r = normalizeRect(marquee);
            return (
              <Rect
                x={r.x0}
                y={r.y0}
                width={r.x1 - r.x0}
                height={r.y1 - r.y0}
                stroke="#2563eb"
                strokeWidth={1 / view.scale}
                dash={[6 / view.scale, 4 / view.scale]}
                fill="rgba(37, 99, 235, 0.08)"
                listening={false}
              />
            );
          })()}
          {drawStart && drawEnd && (
            <>
              <Line
                points={[drawStart.x, drawStart.y, drawEnd.x, drawEnd.y]}
                stroke="#0f172a"
                strokeWidth={4 / view.scale}
                dash={[8 / view.scale, 6 / view.scale]}
              />
              <Rect
                x={drawStart.x - 4 / view.scale}
                y={drawStart.y - 4 / view.scale}
                width={8 / view.scale}
                height={8 / view.scale}
                fill="#0f172a"
              />
              <Text
                x={(drawStart.x + drawEnd.x) / 2}
                y={(drawStart.y + drawEnd.y) / 2 - 12 / view.scale}
                text={`${Math.round(Math.hypot(drawEnd.x - drawStart.x, drawEnd.y - drawStart.y))} ס"מ`}
                fontSize={12 / view.scale}
                fill="#0f172a"
              />
            </>
          )}
          {snapHint && (
            <Circle
              x={snapHint.x}
              y={snapHint.y}
              radius={8 / view.scale}
              stroke="#f59e0b"
              strokeWidth={2 / view.scale}
              fill="rgba(245, 158, 11, 0.25)"
              listening={false}
            />
          )}
          {tool === "weld" && <WeldOverlay walls={walls} scale={view.scale} />}
        </Layer>
      </Stage>
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          background: "rgba(255,255,255,0.9)",
          padding: "4px 8px",
          borderRadius: 4,
          fontSize: 12,
          color: "#334155",
          fontFamily: "system-ui, sans-serif",
          direction: "ltr",
        }}
      >
        zoom {Math.round(view.scale * 100)}% · walls {walls.length} · placements {placements.length}
      </div>
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onDeleteWall={(id) => {
            dispatch({ type: "delete-wall", wallId: id });
            setContextMenu(null);
          }}
          onDeletePlacement={(id) => {
            dispatch({ type: "delete-placement", placementId: id });
            setContextMenu(null);
          }}
          onDuplicatePlacement={(id) => {
            const original = placements.find((p) => p.id === id);
            if (original) {
              dispatch({
                type: "insert-placement",
                placement: {
                  ...original,
                  id: `${original.id}:dup:${Date.now()}`,
                  offsetAlongEdge: original.offsetAlongEdge + original.width,
                  source: "manual",
                  flags: [],
                },
              });
            }
            setContextMenu(null);
          }}
        />
      )}
    </div>
  );
}

interface ContextMenuProps {
  state:
    | { screenX: number; screenY: number; kind: "wall"; wallId: string }
    | { screenX: number; screenY: number; kind: "placement"; placementId: string };
  onClose: () => void;
  onDeleteWall: (id: string) => void;
  onDeletePlacement: (id: string) => void;
  onDuplicatePlacement: (id: string) => void;
}

function ContextMenu({
  state,
  onClose,
  onDeleteWall,
  onDeletePlacement,
  onDuplicatePlacement,
}: ContextMenuProps) {
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 10,
        }}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        style={{
          position: "absolute",
          top: state.screenY,
          left: state.screenX,
          zIndex: 11,
          background: "#fff",
          border: "1px solid #cbd5e1",
          borderRadius: 4,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          minWidth: 140,
          padding: 4,
          direction: "rtl",
          fontFamily: "inherit",
        }}
      >
        {state.kind === "wall" ? (
          <MenuItem onClick={() => onDeleteWall(state.wallId)} danger>
            מחק קיר
          </MenuItem>
        ) : (
          <>
            <MenuItem onClick={() => onDuplicatePlacement(state.placementId)}>שכפל</MenuItem>
            <MenuItem onClick={() => onDeletePlacement(state.placementId)} danger>
              מחק פאנל
            </MenuItem>
          </>
        )}
      </div>
    </>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "right",
        padding: "6px 10px",
        border: "none",
        background: "transparent",
        color: danger ? "#b91c1c" : "#0f172a",
        fontFamily: "inherit",
        fontSize: 13,
        cursor: "pointer",
        borderRadius: 3,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? "#fee2e2" : "#f1f5f9")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
