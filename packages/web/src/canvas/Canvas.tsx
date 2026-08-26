import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Circle, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import type { Point } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { duplicatePlacementId } from "../state/placementId.js";
import { Grid } from "./Grid.js";
import { Walls } from "./Walls.js";
import { Placements } from "./Placements.js";
import { CornerClamps } from "./CornerClamps.js";
import { StraightClamps } from "./StraightClamps.js";
import { WeldOverlay } from "./WeldOverlay.js";
import { ENDPOINT_SNAP_PIXELS, applyAxisLock, findEndpointSnapTarget, formatLength, snapEndpoint } from "./geometry.js";

const MIN_SCALE = 0.05;
const MAX_SCALE = 5;

// Drawing a preview line updates Canvas-local state on every pointer move.
// These heavy, calculated layers have stable props during that gesture and
// must not reconcile hundreds of Konva nodes just because the preview moved.
const MemoGrid = memo(Grid);
const MemoWalls = memo(Walls);
const MemoPlacements = memo(Placements);
const MemoStraightClamps = memo(StraightClamps);
const MemoCornerClamps = memo(CornerClamps);

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
  const stageRef = useRef<Konva.Stage>(null);
  const size = useSize(containerRef);
  const { view, tool, selectedWallId, selectedWallIds, selectedPlacementId, units, orthoLock } =
    state.ui;
  const { walls, pours, placements, rules, layout } = state.project;

  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawEnd, setDrawEnd] = useState<Point | null>(null);
  // 'dragging' = mouse held after mousedown; 'awaiting-second' = first click
  // placed, waiting for a second click to commit; 'idle' otherwise.
  const [drawMode, setDrawMode] = useState<"idle" | "dragging" | "awaiting-second">("idle");
  const mouseDownPixelRef = useRef<{ x: number; y: number } | null>(null);
  // Latest raw (un-axis-locked) mouse world position while drawing. Kept so
  // pressing/releasing Shift can re-apply the lock instantly, without
  // waiting for the next mousemove event.
  const rawDrawEndRef = useRef<Point | null>(null);
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

  // Middle-button pan. Deliberately NOT a tool: switching the active tool to
  // pan and back would cancel a half-drawn wall and lose the modifier state,
  // and the user expects to nudge the viewport mid-draw and carry on. Held in
  // a ref because every pointer handler reads it and none should re-render.
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    currentX: number;
    currentY: number;
    scale: number;
    rafId: number | null;
    stageWasDraggable: boolean;
    previousCursor: string;
  } | null>(null);
  const wheelRef = useRef<{
    baseScale: number;
    baseOffset: Point;
    currentScale: number;
    currentOffset: Point;
    rafId: number | null;
    timerId: number | null;
  } | null>(null);

  const endPan = useCallback((target: Element | null, pointerId: number) => {
    const pan = panRef.current;
    if (pan?.pointerId !== pointerId) return;
    if (pan.rafId !== null) window.cancelAnimationFrame(pan.rafId);
    panRef.current = null;
    const stage = stageRef.current;
    const stageContainer = stage?.container();
    if (stageContainer) {
      stageContainer.style.transform = "";
      stageContainer.style.transformOrigin = "";
      stageContainer.style.willChange = "";
    }
    stage?.draggable(pan.stageWasDraggable);
    if (target instanceof HTMLElement) target.style.cursor = pan.previousCursor;
    if (pan.currentX !== pan.originX || pan.currentY !== pan.originY) {
      // Persist the camera once at gesture end. Dispatching on every pointer
      // move used to re-render hundreds of panels and labels per mouse pixel.
      dispatch({
        type: "set-view",
        view: { scale: pan.scale, offset: { x: pan.currentX, y: pan.currentY } },
      });
    }
    if (target && "releasePointerCapture" in target) {
      try {
        (target as HTMLElement).releasePointerCapture(pointerId);
      } catch {
        // Already released — the browser does this itself on pointercancel.
      }
    }
  }, [dispatch]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 1) return;
      // Without this the browser opens its auto-scroll widget on middle-click.
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const stage = stageRef.current;
      const stageWasDraggable = stage?.draggable() ?? false;
      stage?.stopDrag();
      stage?.draggable(false);
      panRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: view.offset.x,
        originY: view.offset.y,
        currentX: view.offset.x,
        currentY: view.offset.y,
        scale: view.scale,
        rafId: null,
        stageWasDraggable,
        previousCursor: e.currentTarget.style.cursor,
      };
      const stageContainer = stage?.container();
      if (stageContainer) {
        stageContainer.style.transformOrigin = "0 0";
        stageContainer.style.willChange = "transform";
      }
      e.currentTarget.style.cursor = "grabbing";
    },
    [view.offset.x, view.offset.y, view.scale]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      if (!pan || pan.pointerId !== e.pointerId) return;
      e.preventDefault();
      pan.currentX = pan.originX + (e.clientX - pan.startX);
      pan.currentY = pan.originY + (e.clientY - pan.startY);
      if (pan.rafId !== null) return;
      pan.rafId = window.requestAnimationFrame(() => {
        const active = panRef.current;
        if (!active) return;
        active.rafId = null;
        const stageContainer = stageRef.current?.container();
        if (!stageContainer) return;
        const dx = active.currentX - active.originX;
        const dy = active.currentY - active.originY;
        // GPU-composite the already painted canvases while the pointer moves;
        // Konva redraws once after the final view is committed above.
        stageContainer.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
    },
    []
  );

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
      if (panRef.current) return;
      const stage = e.target.getStage();
      const host = containerRef.current;
      if (!stage || !host) return;
      const hostRect = host.getBoundingClientRect();
      const pointer = {
        x: e.evt.clientX - hostRect.left,
        y: e.evt.clientY - hostRect.top,
      };
      let gesture = wheelRef.current;
      if (!gesture) {
        gesture = {
          baseScale: view.scale,
          baseOffset: view.offset,
          currentScale: view.scale,
          currentOffset: view.offset,
          rafId: null,
          timerId: null,
        };
        wheelRef.current = gesture;
        const stageContainer = stage.container();
        stageContainer.style.transformOrigin = "0 0";
        stageContainer.style.willChange = "transform";
      }
      const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, gesture.currentScale * factor)
      );
      const world = {
        x: (pointer.x - gesture.currentOffset.x) / gesture.currentScale,
        y: (pointer.y - gesture.currentOffset.y) / gesture.currentScale,
      };
      // Zoom around the pointer: keep the world point under the cursor fixed.
      const newOffset = {
        x: pointer.x - world.x * newScale,
        y: pointer.y - world.y * newScale,
      };
      gesture.currentScale = newScale;
      gesture.currentOffset = newOffset;

      if (gesture.rafId === null) {
        gesture.rafId = window.requestAnimationFrame(() => {
          const active = wheelRef.current;
          const stageContainer = stageRef.current?.container();
          if (!active || !stageContainer) return;
          active.rafId = null;
          const ratio = active.currentScale / active.baseScale;
          const tx = active.currentOffset.x - ratio * active.baseOffset.x;
          const ty = active.currentOffset.y - ratio * active.baseOffset.y;
          stageContainer.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${ratio})`;
        });
      }

      if (gesture.timerId !== null) window.clearTimeout(gesture.timerId);
      gesture.timerId = window.setTimeout(() => {
        const completed = wheelRef.current;
        if (!completed) return;
        if (completed.rafId !== null) window.cancelAnimationFrame(completed.rafId);
        wheelRef.current = null;
        const stageContainer = stageRef.current?.container();
        if (stageContainer) {
          stageContainer.style.transform = "";
          stageContainer.style.transformOrigin = "";
          stageContainer.style.willChange = "";
        }
        // One React/Konva render for the complete wheel gesture.
        dispatch({
          type: "set-view",
          view: { scale: completed.currentScale, offset: completed.currentOffset },
        });
      }, 90);
    },
    [view.scale, view.offset, dispatch]
  );

  useEffect(
    () => () => {
      const gesture = wheelRef.current;
      if (!gesture) return;
      if (gesture.rafId !== null) window.cancelAnimationFrame(gesture.rafId);
      if (gesture.timerId !== null) window.clearTimeout(gesture.timerId);
    },
    []
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
    rawDrawEndRef.current = null;
  }, []);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (panRef.current) return;
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
        const end = applyAxisLock(drawStart, snapEndpoint(world, walls, snapCm), orthoLock);
        commitWall(drawStart, end);
        cancelDraw();
        return;
      }

      const snapped = snapEndpoint(world, walls, snapCm);
      setDrawStart(snapped);
      setDrawEnd(snapped);
      rawDrawEndRef.current = snapped;
      setDrawMode("dragging");
      setSnapHint(findEndpointSnapTarget(world, walls, snapCm));
      mouseDownPixelRef.current = { x: pointer.x, y: pointer.y };
    },
    [tool, walls, stageToWorld, drawMode, drawStart, commitWall, cancelDraw, snapCm]
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (panRef.current) return;
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
      const snapped = snapEndpoint(world, walls, snapCm);
      rawDrawEndRef.current = snapped;
      setDrawEnd(applyAxisLock(drawStart, snapped, orthoLock));
      setSnapHint(findEndpointSnapTarget(world, walls, snapCm));
    },
    [tool, drawStart, walls, stageToWorld, marquee, snapCm]
  );

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (panRef.current) return;
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

      commitWall(drawStart, applyAxisLock(drawStart, drawEnd, orthoLock));
      cancelDraw();
    },
    [tool, drawMode, drawStart, drawEnd, commitWall, cancelDraw, marquee, walls, dispatch]
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (panRef.current) return;
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

  // Shift flips the ortho lock. One keydown per press: the repeat events from
  // holding the key would otherwise flap the mode on and off, and there is no
  // keyup handler at all — releasing Shift must not undo the user's choice.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      dispatch({ type: "set-ortho-lock", value: !orthoLock });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, orthoLock]);

  // Re-apply the lock to the wall being drawn the moment the mode changes,
  // rather than at the next mousemove — waiting for the user to jiggle the
  // cursor before the line snaps feels broken on the CAD tools they know.
  useEffect(() => {
    if (tool !== "draw-wall" || !drawStart) return;
    const raw = rawDrawEndRef.current;
    if (!raw) return;
    setDrawEnd(applyAxisLock(drawStart, raw, orthoLock));
  }, [orthoLock, tool, drawStart]);

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

  const selectWall = useCallback(
    (id: string | null) => dispatch({ type: "select-wall", wallId: id }),
    [dispatch]
  );
  const openWallContextMenu = useCallback(
    (id: string, x: number, y: number) =>
      setContextMenu({ kind: "wall", wallId: id, screenX: x, screenY: y }),
    []
  );
  const selectPlacement = useCallback(
    (id: string | null) => dispatch({ type: "select-placement", placementId: id }),
    [dispatch]
  );
  const openPlacementContextMenu = useCallback(
    (id: string, x: number, y: number) =>
      setContextMenu({ kind: "placement", placementId: id, screenX: x, screenY: y }),
    []
  );

  const cursor = tool === "draw-wall"
      ? "crosshair"
      : tool === "weld"
        ? "cell"
        : "default";

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, background: "#f8fafc", position: "relative", cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => endPan(e.currentTarget, e.pointerId)}
      onPointerCancel={(e) => endPan(e.currentTarget, e.pointerId)}
      // The browser opens its auto-scroll widget on middle-click unless both
      // the pointerdown and the resulting auxclick are suppressed.
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
    >
      <Stage
        ref={stageRef}
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
          <MemoGrid
            widthPx={size.width}
            heightPx={size.height}
            scale={view.scale}
            offsetX={view.offset.x}
            offsetY={view.offset.y}
          />
        </Layer>
        <Layer>
          <MemoWalls
            walls={walls}
            pours={pours}
            layout={layout}
            selectedWallId={selectedWallId}
            selectedWallIds={selectedWallIds}
            scale={view.scale}
            onSelect={selectWall}
            onContextMenu={openWallContextMenu}
          />
        </Layer>
        <Layer>
          <MemoPlacements
            walls={walls}
            placements={placements}
            layout={layout}
            selectedPlacementId={selectedPlacementId}
            scale={view.scale}
            onSelect={selectPlacement}
            onContextMenu={openPlacementContextMenu}
          />
        </Layer>
        <Layer listening={false}>
          <MemoStraightClamps
            walls={walls}
            placements={placements}
            layout={layout}
            rules={rules}
            scale={view.scale}
          />
          <MemoCornerClamps
            walls={walls}
            placements={placements}
            layout={layout}
            rules={rules}
            scale={view.scale}
            externalCorners={layout?.externalCorners}
          />
        </Layer>
        <Layer>
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
                text={formatLength(Math.hypot(drawEnd.x - drawStart.x, drawEnd.y - drawStart.y), units)}
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
                  id: duplicatePlacementId(original),
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
