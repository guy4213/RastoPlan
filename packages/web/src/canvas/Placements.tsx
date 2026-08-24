import { useMemo } from "react";
import { Group, Line, Text } from "react-konva";
import type Konva from "konva";
import type { Placement, Point, ProjectLayout, Wall } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import {
  PLACEMENT_BAND_DEPTH_CM,
  placementBandCorners,
  placementsWithOuterCornerJoint,
  wallDirection,
} from "./geometry.js";
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
  if (placement.flags.includes("outer-corner-protrusion"))
    return { fill: "#e0e7ff", stroke: "#4f46e5", text: "#3730a3" };
  if (placement.kind === "timber") return { fill: "#fde68a", stroke: "#a16207", text: "#713f12" };
  if (placement.kind === "corner-panel")
    return { fill: "#cffafe", stroke: "#0e7490", text: "#155e75" };
  // Green reads as "faces a room", blue as "faces the outside" — so a
  // partition between two rooms comes out green on both faces.
  if (!placement.faceIsInterior) return { fill: "#dbeafe", stroke: "#1d4ed8", text: "#1e3a8a" };
  return { fill: "#dcfce7", stroke: "#15803d", text: "#14532d" };
}

/**
 * The mitre line across a corner-panel leg, running from the wall vertex to
 * the far outer corner of the band. `atStart` says which end of the leg sits
 * on the vertex: the leg before the run starts at its far end, the one after
 * it at its near end.
 */
function foldPoints(c0: Point, c1: Point, c2: Point, c3: Point, atStart: boolean): number[] {
  // c0..c1 lie on the wall line, c2..c3 on the band's outer edge.
  return atStart ? [c1.x, c1.y, c3.x, c3.y] : [c0.x, c0.y, c2.x, c2.y];
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
  const { state, dispatch } = useProject();
  const wallById = useMemo(() => new Map(walls.map((w) => [w.id, w])), [walls]);
  const depth = PLACEMENT_BAND_DEPTH_CM;
  const cornerProtrusion = state.project.rules.outerCornerProtrusionCm;
  const cornerClearance = state.project.rules.outerCornerLapGapCm;

  // One physical corner panel is two legs sharing a groupId. Labelling both
  // printed "C30x30" and "30" next to each other on one panel, which is what
  // made the corner read as two blocks instead of one wrapped panel.
  const labelledIds = useMemo(() => {
    const firstOfGroup = new Map<string, string>();
    for (const p of placements) {
      if (!p.groupId) continue;
      const current = firstOfGroup.get(p.groupId);
      if (!current || p.id < current) firstOfGroup.set(p.groupId, p.id);
    }
    return new Set(firstOfGroup.values());
  }, [placements]);

  // Canvas-only copies: exactly one panel owns each outside corner square and
  // stops 2cm short of its outer edge; the other stops at the square's side.
  // On the orthogonal reference the deterministic owner is the vertical panel.
  // Engine placements and quantities stay intact.
  const paintedPlacements = useMemo(
    () =>
      placementsWithOuterCornerJoint(
        placements,
        walls,
        layout,
        cornerProtrusion,
        cornerClearance
      ),
    [placements, walls, layout, cornerProtrusion, cornerClearance]
  );
  const paintedById = useMemo(
    () => new Map(paintedPlacements.map((placement) => [placement.id, placement])),
    [paintedPlacements]
  );
  return (
    <>
      {placements.map((placement) => {
        const wall = wallById.get(placement.wallId);
        if (!wall) return null;

        const frame = resolvedWallFrame(wall, layout, walls);
        const dir = wallDirection(wall);

        // Render the visual corner joint from the copied placement, while the
        // original placement remains the source for editing and calculations.
        const paintedPlacement = paintedById.get(placement.id) ?? placement;
        const [c0, c1, c2, c3] = placementBandCorners(paintedPlacement, wall, frame, depth);
        const points = [c0.x, c0.y, c1.x, c1.y, c2.x, c2.y, c3.x, c3.y];

        const colors = colorsFor(placement);
        const selected = placement.id === selectedPlacementId;

        // Centre of the band, straight off its own corners.
        const labelPos = {
          x: (c0.x + c1.x + c2.x + c3.x) / 4,
          y: (c0.y + c1.y + c2.y + c3.y) / 4,
        };
        const angleDeg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;

        // A corner panel is drawn deeper than a straight one and outlined
        // heavier, so the leg reads as the wrapped panel it is rather than as a
        // gap where the straight run stops. It only ever exists on a face that
        // borders a room; outside panels meet edge-to-edge without overlapping.
        const isCornerLeg = placement.kind === "corner-panel";

        const labelText =
          placement.flags.includes("inventory-shortage")
            ? `חסר ${placement.panelType}`
            : placement.kind === "timber"
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
            {/* The 45° fold at the corner, as the AutoCAD detail draws it: one
                panel bent around the corner, not two blocks butted together. */}
            {isCornerLeg && (
              <Line
                points={foldPoints(c0, c1, c2, c3, placement.offsetAlongEdge < 0)}
                stroke={colors.stroke}
                strokeWidth={1 / scale}
                opacity={0.75}
                listening={false}
              />
            )}
            {(() => {
              // Only render the label when it can actually fit inside the
              // placement band (with a small margin) — otherwise the letters
              // spill over neighbouring panels and turn into visual noise.
              // Selected placement is always labelled so the user can see
              // what they picked, even if it's cramped.
              const fontSize = 10 / scale;
              const labelWidthCm = labelText.length * fontSize * 0.6;
              const fits = labelWidthCm < placement.width * 0.85;
              if (placement.groupId && !labelledIds.has(placement.id)) return null;
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
