import { useMemo } from "react";
import { Circle, Group } from "react-konva";
import type { AccessoryRules, Placement, ProjectLayout, Wall } from "@rastoplan/core";
import { wallDirection, wallNormal } from "./geometry.js";
import { resolvedWallFrame } from "./resolvedWallFrame.js";

interface Props {
  walls: Wall[];
  placements: Placement[];
  layout: ProjectLayout | undefined;
  rules: AccessoryRules;
  scale: number;
}

interface SeamMarker {
  key: string;
  x: number;
  y: number;
  /** unit direction across the wall, along which the clamps are spread */
  acrossX: number;
  acrossY: number;
  count: number;
}

/** Same visual band depth Placements uses, so the dots land on the panels. */
const BAND_DEPTH_CM = 8;

/**
 * A K10 straight clamp joins each neighbouring pair of panels, so there is one
 * cluster per seam — not per panel. The BOM counts them per panel and has done
 * all along; nothing ever drew them, which is why the corners looked clamped
 * and the straight runs looked bare.
 *
 * Seams are read off the placements themselves: two panels on the same face of
 * the same edge whose offsets meet exactly. Manual edits therefore move their
 * clamps with them, and a hand-made gap correctly shows no clamp.
 */
function computeSeams(
  walls: Wall[],
  placements: Placement[],
  layout: ProjectLayout | undefined,
  clampsPerJoint: number
): SeamMarker[] {
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const byFace = new Map<string, Placement[]>();

  for (const p of placements) {
    if (p.kind === "timber") continue;
    if (p.flags.includes("outer-corner-protrusion")) continue;
    const key = `${p.edgeId}:${p.side}`;
    byFace.set(key, [...(byFace.get(key) ?? []), p]);
  }

  const markers: SeamMarker[] = [];
  for (const [key, run] of byFace) {
    const wall = wallById.get(run[0]!.wallId);
    if (!wall) continue;

    const frame = resolvedWallFrame(wall, layout);
    const dir = wallDirection(wall);
    const n = wallNormal(wall);
    const isFaceB = run[0]!.side === "faceB";
    const bandSign = isFaceB ? frame.outwardSign : -frame.outwardSign;
    const base = isFaceB ? frame.faceBOffsetCm * frame.outwardSign : 0;

    const sorted = [...run].sort((a, b) => a.offsetAlongEdge - b.offsetAlongEdge);
    for (let i = 0; i < sorted.length - 1; i++) {
      const end = sorted[i]!.offsetAlongEdge + sorted[i]!.width;
      // Only a real butt joint carries a clamp; a gap left by a hand edit
      // has nothing to clamp together.
      if (Math.abs(end - sorted[i + 1]!.offsetAlongEdge) > 0.5) continue;

      const across = base + bandSign * (BAND_DEPTH_CM / 2);
      markers.push({
        key: `${key}:${i}`,
        x: wall.innerLine[0].x + dir.x * end + n.x * across,
        y: wall.innerLine[0].y + dir.y * end + n.y * across,
        acrossX: n.x * bandSign,
        acrossY: n.y * bandSign,
        count: Math.max(1, Math.round(clampsPerJoint)),
      });
    }
  }

  return markers;
}

export function StraightClamps({ walls, placements, layout, rules, scale }: Props) {
  const markers = useMemo(
    () => computeSeams(walls, placements, layout, rules.clampsPerStraightJoint),
    [walls, placements, layout, rules.clampsPerStraightJoint]
  );

  const dotRadius = 2.2;
  const spacing = 4.5; // cm between centres, across the band

  return (
    <>
      {markers.map((m) => {
        const shift = ((m.count - 1) * spacing) / 2;
        return (
          <Group key={`k10:${m.key}`} listening={false}>
            {Array.from({ length: m.count }, (_, i) => {
              const t = i * spacing - shift;
              return (
                <Circle
                  key={i}
                  x={m.x + m.acrossX * t}
                  y={m.y + m.acrossY * t}
                  radius={dotRadius}
                  fill="#0891b2"
                  stroke="#164e63"
                  strokeWidth={0.5 / scale}
                  opacity={0.95}
                />
              );
            })}
          </Group>
        );
      })}
    </>
  );
}
