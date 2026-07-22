import { useCallback, useEffect, useRef, useState } from "react";
import { Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import type { Point } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { Grid } from "./Grid.js";
import { Walls } from "./Walls.js";
import { Placements } from "./Placements.js";
import { snapEndpoint } from "./geometry.js";

const MIN_SCALE = 0.05;
const MAX_SCALE = 5;

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
  const { view, tool, selectedWallId, selectedPlacementId } = state.ui;
  const { walls, pours, placements } = state.project;

  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawEnd, setDrawEnd] = useState<Point | null>(null);

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

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (tool !== "draw-wall") return;
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const world = stageToWorld(pointer.x, pointer.y);
      const snapped = snapEndpoint(world, walls, null, 20);
      setDrawStart(snapped);
      setDrawEnd(snapped);
    },
    [tool, walls, stageToWorld]
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (tool !== "draw-wall" || !drawStart) return;
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const world = stageToWorld(pointer.x, pointer.y);
      const snapped = snapEndpoint(world, walls, drawStart, 20);
      setDrawEnd(snapped);
    },
    [tool, drawStart, walls, stageToWorld]
  );

  const handleMouseUp = useCallback(() => {
    if (tool !== "draw-wall" || !drawStart || !drawEnd) {
      setDrawStart(null);
      setDrawEnd(null);
      return;
    }
    const dx = drawEnd.x - drawStart.x;
    const dy = drawEnd.y - drawStart.y;
    if (Math.hypot(dx, dy) >= 10) {
      dispatch({
        type: "add-wall",
        a: { x: Math.round(drawStart.x), y: Math.round(drawStart.y) },
        b: { x: Math.round(drawEnd.x), y: Math.round(drawEnd.y) },
      });
    }
    setDrawStart(null);
    setDrawEnd(null);
  }, [tool, drawStart, drawEnd, dispatch]);

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Clicking blank stage clears selection (Konva sets target to Stage).
      if (e.target === e.target.getStage()) {
        dispatch({ type: "select-wall", wallId: null });
      }
    },
    [dispatch]
  );

  // Keyboard shortcut: Delete selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedWallId) dispatch({ type: "delete-wall", wallId: selectedWallId });
      else if (selectedPlacementId) dispatch({ type: "delete-placement", placementId: selectedPlacementId });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedWallId, selectedPlacementId, dispatch]);

  const cursor = tool === "draw-wall" ? "crosshair" : "default";

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
        draggable={tool === "select"}
        x={view.offset.x}
        y={view.offset.y}
        scaleX={view.scale}
        scaleY={view.scale}
        onDragEnd={(e) => {
          dispatch({
            type: "set-view",
            view: { scale: view.scale, offset: { x: e.target.x(), y: e.target.y() } },
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
            scale={view.scale}
            onSelect={(id) => dispatch({ type: "select-wall", wallId: id })}
          />
          <Placements
            walls={walls}
            placements={placements}
            selectedPlacementId={selectedPlacementId}
            scale={view.scale}
            onSelect={(id) => dispatch({ type: "select-placement", placementId: id })}
          />
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
    </div>
  );
}
