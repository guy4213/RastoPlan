import type { Placement, Point, Pour, PrintBoundsCm, PrintPageSize, ProjectLayout, Wall } from "@rastoplan/core";
import { PRINT_PAGE_SIZES_MM, choosePrintScale, pourLabelAnchors } from "@rastoplan/core";
import {
  PLACEMENT_BAND_DEPTH_CM,
  formatLength,
  labelSideByWallId,
  placementBandCorners,
  placementsWithOuterCornerJoint,
  wallDirection,
  wallLabelPlacement,
  wallNormal,
} from "../../canvas/geometry.js";
import { resolvedWallFrame, type ResolvedWallFrame } from "../../canvas/resolvedWallFrame.js";
import { placementLabel } from "../../canvas/placementLabel.js";
import { rtlTextAnchor, uprightRotationDeg } from "./svgTextGeometry.js";

/**
 * Chrome on Windows always has these; Hebrew shaping/bidi is the browser's
 * job either way (that's the whole point of printing via SVG + the browser
 * print dialog instead of a PDF library), this just keeps the digits/Latin
 * glyphs from falling back to a font that renders them oddly next to Hebrew.
 */
const HEBREW_FONT_STACK = 'Arial, "Segoe UI", sans-serif';

const MARGIN_MM = 15;
const TITLE_BLOCK_MM = 30;
/**
 * Headroom (world cm) added around the drawn geometry before choosing a
 * scale, so dimension lines, wall-length labels and pour-name labels — which
 * sit outside the wall/placement bands themselves — still land inside the
 * printable area instead of bleeding off the sheet edge.
 */
const BOUNDS_PADDING_CM = 60;
/** How far outside the wall a length label sits, as a fixed distance on paper (mm) — independent of the chosen scale, like the canvas keeps it independent of zoom. */
const LABEL_OFFSET_MM = 6;

export interface PlanSvgProps {
  projectName: string;
  walls: Wall[];
  pours: Pour[];
  placements: Placement[];
  layout: ProjectLayout | undefined;
  page: PrintPageSize;
  /** From Project.rules — kept as explicit props rather than re-defaulted here, so print never drifts from what the canvas draws. */
  cornerProtrusionCm: number;
  cornerLapGapCm: number;
  /** ISO date string for the title block. Defaults to "now"; pass explicitly for a deterministic test/snapshot. */
  generatedAt?: string;
}

function formatDateDDMMYYYY(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * World-space (cm) bounding box of everything that will be drawn: wall
 * centerlines, their derived far faces, and every placement's painted band.
 * This is what choosePrintScale sizes the sheet against — not just the wall
 * endpoints, which would let a wide wall or a protruding corner panel spill
 * off the printable area.
 */
function computeDrawingBoundsCm(
  walls: Wall[],
  placements: Placement[],
  layout: ProjectLayout | undefined
): PrintBoundsCm {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };

  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const frameByWallId = new Map(walls.map((wall) => [wall.id, resolvedWallFrame(wall, layout, walls)]));

  for (const wall of walls) {
    const [a, b] = wall.innerLine;
    grow(a);
    grow(b);
    const frame = frameByWallId.get(wall.id)!;
    const n = wallNormal(wall);
    const push = frame.faceBOffsetCm * frame.outwardSign;
    grow({ x: a.x + n.x * push, y: a.y + n.y * push });
    grow({ x: b.x + n.x * push, y: b.y + n.y * push });
  }

  const painted = placementsWithOuterCornerJoint(placements, walls, layout);
  for (const placement of painted) {
    const wall = wallById.get(placement.wallId);
    if (!wall) continue;
    const frame = frameByWallId.get(wall.id)!;
    const corners = placementBandCorners(placement, wall, frame, PLACEMENT_BAND_DEPTH_CM);
    for (const corner of corners) grow(corner);
  }

  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: minX - BOUNDS_PADDING_CM,
    minY: minY - BOUNDS_PADDING_CM,
    maxX: maxX + BOUNDS_PADDING_CM,
    maxY: maxY + BOUNDS_PADDING_CM,
  };
}

/**
 * The print-ready plan as a plain, static SVG tree — no Konva, no browser
 * globals, safe to render with react-dom/server. Geometry comes from the
 * SAME helpers the Konva canvas uses (canvas/geometry.ts,
 * canvas/resolvedWallFrame.ts, canvas/placementLabel.ts) so the printed plan
 * can never show a different shape or label than what the user last saw on
 * screen.
 */
export function PlanSvg({
  projectName,
  walls,
  pours,
  placements,
  layout,
  page,
  cornerProtrusionCm,
  cornerLapGapCm,
  generatedAt,
}: PlanSvgProps) {
  const { widthMm: pageWidthMm, heightMm: pageHeightMm } = PRINT_PAGE_SIZES_MM[page];
  const bounds = computeDrawingBoundsCm(walls, placements, layout);
  const scaleResult = choosePrintScale(bounds, page, MARGIN_MM, TITLE_BLOCK_MM);
  // `choosePrintScale` deliberately reports fits:false once the drawing is
  // larger than the smallest standard scale. Printing must still never clip:
  // fall back to the exact (possibly non-standard) denominator that fits both
  // axes, and report that real scale in the title block.
  const requiredScale = Math.ceil(
    Math.max(
      ((bounds.maxX - bounds.minX) * 10) / Math.max(1, scaleResult.printableWidthMm),
      ((bounds.maxY - bounds.minY) * 10) / Math.max(1, scaleResult.printableHeightMm)
    )
  );
  const printScale = scaleResult.fits ? scaleResult.scale : Math.max(scaleResult.scale, requiredScale);
  const mmPerCm = 10 / printScale;

  // Centre the drawing within the printable area (rather than pinning it to
  // the top-left corner) — the chosen scale already guarantees it fits, so
  // any slack is split evenly on both axes.
  const drawnWidthMm = (bounds.maxX - bounds.minX) * mmPerCm;
  const drawnHeightMm = (bounds.maxY - bounds.minY) * mmPerCm;
  const offsetXMm = MARGIN_MM + Math.max(0, (scaleResult.printableWidthMm - drawnWidthMm) / 2);
  const offsetYMm = MARGIN_MM + Math.max(0, (scaleResult.printableHeightMm - drawnHeightMm) / 2);

  const toMm = (p: Point): Point => ({
    x: (p.x - bounds.minX) * mmPerCm + offsetXMm,
    y: (p.y - bounds.minY) * mmPerCm + offsetYMm,
  });

  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const frameByWallId = new Map<string, ResolvedWallFrame>(
    walls.map((wall) => [wall.id, resolvedWallFrame(wall, layout, walls)])
  );
  const labelSides = labelSideByWallId(walls);
  const colorByPourId = new Map(pours.map((pour) => [pour.id, pour.color]));
  const painted = placementsWithOuterCornerJoint(placements, walls, layout, cornerProtrusionCm, cornerLapGapCm);
  const paintedById = new Map(painted.map((placement) => [placement.id, placement]));
  const anchors = pourLabelAnchors(walls, pours);
  const labelOffsetCm = LABEL_OFFSET_MM / mmPerCm;
  const dateText = formatDateDDMMYYYY(generatedAt ?? new Date().toISOString());
  const scaleText = `1:${printScale}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={`${pageWidthMm}mm`}
      height={`${pageHeightMm}mm`}
      viewBox={`0 0 ${pageWidthMm} ${pageHeightMm}`}
      direction="rtl"
    >
      <rect x={0} y={0} width={pageWidthMm} height={pageHeightMm} fill="#ffffff" />

      <g data-layer="walls">
        {walls.map((wall) => {
          const frame = frameByWallId.get(wall.id)!;
          const [a, b] = wall.innerLine;
          const innerA = toMm(a);
          const innerB = toMm(b);
          const n = wallNormal(wall);
          const push = frame.faceBOffsetCm * frame.outwardSign;
          const outerA = toMm({ x: a.x + n.x * push, y: a.y + n.y * push });
          const outerB = toMm({ x: b.x + n.x * push, y: b.y + n.y * push });
          const color = colorByPourId.get(wall.pourId) ?? "#475569";

          return (
            <g key={wall.id}>
              <line
                x1={innerA.x}
                y1={innerA.y}
                x2={innerB.x}
                y2={innerB.y}
                stroke={color}
                strokeWidth={frame.isConsumed ? 0.5 : 0.9}
                strokeDasharray={frame.isConsumed ? "3 2" : undefined}
                opacity={frame.isConsumed ? 0.45 : 1}
              />
              {/* Same rule as the canvas: a derived far face is drawn only when
                  nothing already draws that line (a consumed wall IS the far
                  face, and a drawn-pair partner already shows it). */}
              {!frame.isConsumed && !frame.faceBIsDrawn && frame.thicknessIsSet && (
                <line
                  x1={outerA.x}
                  y1={outerA.y}
                  x2={outerB.x}
                  y2={outerB.y}
                  stroke={color}
                  strokeWidth={0.3}
                  strokeDasharray="1.5 1"
                  opacity={0.4}
                />
              )}
            </g>
          );
        })}
      </g>

      <g data-layer="placements">
        {placements.map((placement) => {
          const wall = wallById.get(placement.wallId);
          if (!wall) return null;
          const frame = frameByWallId.get(wall.id)!;
          const paintedPlacement = paintedById.get(placement.id) ?? placement;
          const corners = placementBandCorners(paintedPlacement, wall, frame, PLACEMENT_BAND_DEPTH_CM);
          const cornersMm = corners.map((corner) => toMm(corner));
          const pointsAttr = cornersMm.map((p) => `${p.x},${p.y}`).join(" ");
          const color = colorByPourId.get(placement.pourId) ?? "#475569";
          const label = placementLabel(placement);
          const center = {
            x: cornersMm.reduce((sum, p) => sum + p.x, 0) / cornersMm.length,
            y: cornersMm.reduce((sum, p) => sum + p.y, 0) / cornersMm.length,
          };
          const dir = wallDirection(wall);
          const rawAngleDeg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
          // Unlike the raw wall angle, a printed label must never read upside
          // down — a wall drawn right-to-left/bottom-to-top would otherwise
          // rotate its panel label ~180°, same anchor point either way.
          const angleDeg = uprightRotationDeg(rawAngleDeg);

          return (
            <g key={placement.id}>
              <polygon points={pointsAttr} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={0.25} />
              <text
                x={center.x}
                y={center.y}
                fontSize={2.4}
                fill="#0f172a"
                textAnchor={rtlTextAnchor("center")}
                dominantBaseline="middle"
                transform={`rotate(${angleDeg} ${center.x} ${center.y})`}
                fontFamily={HEBREW_FONT_STACK}
                direction="rtl"
                style={{ unicodeBidi: "plaintext" }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </g>

      <g data-layer="wall-dimensions">
        {walls.map((wall) => {
          const [a, b] = wall.innerLine;
          const lengthCm = Math.hypot(b.x - a.x, b.y - a.y);
          const side = labelSides.get(wall.id) ?? 1;
          const placed = wallLabelPlacement(wall, side, labelOffsetCm);
          if (!placed) return null;
          const p = toMm({ x: placed.x, y: placed.y });
          const text = formatLength(lengthCm, "cm");
          // wallLabelPlacement already tries to avoid upside-down text, but
          // it has an exact -90° boundary gap (a wall drawn precisely
          // bottom-to-top keeps rotationDeg at -90 instead of folding to 90)
          // — printed on paper that reads flipped, so the print layer folds
          // independently rather than depending on that upstream case.
          const rotationDeg = uprightRotationDeg(placed.rotationDeg);

          return (
            <text
              key={`dim:${wall.id}`}
              x={p.x}
              y={p.y}
              fontSize={2.6}
              fill="#334155"
              textAnchor={rtlTextAnchor("center")}
              dominantBaseline="middle"
              transform={`rotate(${rotationDeg} ${p.x} ${p.y})`}
              fontFamily={HEBREW_FONT_STACK}
              direction="rtl"
              style={{ unicodeBidi: "plaintext" }}
            >
              {text}
            </text>
          );
        })}
      </g>

      <g data-layer="pour-labels">
        {anchors.map((anchor) => {
          const p = toMm(anchor.point);
          const color = colorByPourId.get(anchor.pourId) ?? "#0f172a";

          return (
            <text
              key={`pour:${anchor.pourId}:${anchor.wallIds.join(",")}`}
              x={p.x}
              y={p.y}
              fontSize={4.2}
              fontWeight="bold"
              fill={color}
              textAnchor={rtlTextAnchor("center")}
              dominantBaseline="middle"
              fontFamily={HEBREW_FONT_STACK}
              direction="rtl"
              style={{ unicodeBidi: "plaintext" }}
            >
              {anchor.name}
            </text>
          );
        })}
      </g>

      <g data-layer="title-block">
        <line
          x1={0}
          y1={pageHeightMm - TITLE_BLOCK_MM}
          x2={pageWidthMm}
          y2={pageHeightMm - TITLE_BLOCK_MM}
          stroke="#0f172a"
          strokeWidth={0.4}
        />
        {/* text-anchor is relative to the string's OWN reading direction, not
            the page — for direction="rtl" text, "end" is the visual LEFT
            edge, so anchoring the right-margin x with "end" let the string
            run off the right side of the sheet. rtlTextAnchor("right") gives
            the anchor that actually keeps RTL text's right edge at x. */}
        <text
          x={pageWidthMm - MARGIN_MM}
          y={pageHeightMm - TITLE_BLOCK_MM / 2 - 4}
          fontSize={5}
          fontWeight="bold"
          fill="#0f172a"
          textAnchor={rtlTextAnchor("right")}
          dominantBaseline="middle"
          fontFamily={HEBREW_FONT_STACK}
          direction="rtl"
          style={{ unicodeBidi: "plaintext" }}
        >
          {projectName}
        </text>
        <text
          x={pageWidthMm - MARGIN_MM}
          y={pageHeightMm - TITLE_BLOCK_MM / 2 + 6}
          fontSize={3}
          fill="#334155"
          textAnchor={rtlTextAnchor("right")}
          dominantBaseline="middle"
          fontFamily={HEBREW_FONT_STACK}
          direction="rtl"
          style={{ unicodeBidi: "plaintext" }}
        >
          {`${dateText} · גיליון ${page} · קנה מידה ${scaleText}`}
        </text>
      </g>
    </svg>
  );
}
