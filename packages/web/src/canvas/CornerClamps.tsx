import { useMemo } from "react";
import { Circle, Group, Text } from "react-konva";
import type { AccessoryRules, Placement, Wall } from "@rastoplan/core";
import { wallDirection, wallNormal } from "./geometry.js";

interface Props {
  walls: Wall[];
  placements: Placement[];
  rules: AccessoryRules;
  scale: number;
}

interface CornerMarker {
  key: string;
  x: number;
  y: number;
  /** unit inward direction (into the room interior) for arranging the dots */
  inwardX: number;
  inwardY: number;
  /** unit along-wall direction, used to spread the dot cluster tangentially */
  alongX: number;
  alongY: number;
  count: number;
}

/**
 * K30 corner clamps have no coordinate in the data model — the BOM lists a
 * count per pour and stops there. To let the customer verify the count
 * visually on the drawing, we derive marker positions from the corner-panel
 * placements themselves:
 *
 *   - Each physical corner panel is 2 placements sharing a `groupId` (one
 *     leg per meeting wall). We dedupe by groupId so each corner gets one
 *     marker cluster, not two.
 *   - The corner vertex is at innerLine[0] when the placement sits before
 *     the clear run (offsetAlongEdge < 0) and innerLine[1] otherwise —
 *     matching how placeCornerPanels emits them (end="A" vs end="B").
 *   - `cornerClampsPerCorner` dots are drawn in a small cluster nudged
 *     into the room's interior so they sit inside the corner-panel band.
 */
function computeMarkers(
  walls: Wall[],
  placements: Placement[],
  clampsPerCorner: number
): CornerMarker[] {
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const seen = new Set<string>();
  const markers: CornerMarker[] = [];

  for (const p of placements) {
    if (p.kind !== "corner-panel") continue;
    const key = p.groupId ?? p.id;
    if (seen.has(key)) continue;
    seen.add(key);

    const wall = wallById.get(p.edgeId.replace(/^edge:/, ""));
    if (!wall) continue;

    const atA = p.offsetAlongEdge < 0;
    const vertex = atA ? wall.innerLine[0] : wall.innerLine[1];
    const dir = wallDirection(wall);
    const n = wallNormal(wall);
    // Corner panels sit on the inner face — normal points outward, so inward
    // is the negative normal. Push the marker cluster ~10cm inward so it
    // lands visibly on the drawing rather than dead on the wall line.
    const inwardX = -n.x;
    const inwardY = -n.y;
    // Spread the cluster tangentially along the wall so 3 dots don't stack.
    // If we're at end A, spread into the wall (+dir); at end B, spread
    // back into the wall (-dir).
    const spreadSign = atA ? 1 : -1;

    markers.push({
      key,
      x: vertex.x + inwardX * 8,
      y: vertex.y + inwardY * 8,
      inwardX,
      inwardY,
      alongX: dir.x * spreadSign,
      alongY: dir.y * spreadSign,
      count: Math.max(1, Math.round(clampsPerCorner)),
    });
  }

  return markers;
}

/**
 * Renders `cornerClampsPerCorner` small circles at every corner-panel unit.
 * Purely presentational — the BOM is still the source of truth for counts,
 * this only makes the count visible on the drawing.
 */
export function CornerClamps({ walls, placements, rules, scale }: Props) {
  const markers = useMemo(
    () => computeMarkers(walls, placements, rules.cornerClampsPerCorner),
    [walls, placements, rules.cornerClampsPerCorner]
  );

  const dotRadius = 3.5;
  const dotSpacing = 9; // cm between centres along the wall

  return (
    <>
      {markers.map((m) => {
        const centreShift = ((m.count - 1) * dotSpacing) / 2;
        return (
          <Group key={`k30:${m.key}`} listening={false}>
            {Array.from({ length: m.count }, (_, i) => {
              const t = i * dotSpacing - centreShift;
              return (
                <Circle
                  key={i}
                  x={m.x + m.alongX * t}
                  y={m.y + m.alongY * t}
                  radius={dotRadius}
                  fill="#ea580c"
                  stroke="#7c2d12"
                  strokeWidth={0.6 / scale}
                  opacity={0.95}
                />
              );
            })}
            <Text
              x={m.x + m.inwardX * 8}
              y={m.y + m.inwardY * 8}
              text={`K30×${m.count}`}
              fontSize={9 / scale}
              fill="#7c2d12"
              offsetX={12 / scale}
              offsetY={4 / scale}
            />
          </Group>
        );
      })}
    </>
  );
}
