import { useState } from "react";
import type { KeyboardEvent } from "react";
import { countPanels, type Point } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { MAX_WALL_THICKNESS_CM, MIN_WALL_THICKNESS_CM } from "../state/project.js";
import { formatLength } from "../canvas/geometry.js";
import { displayedWallThickness } from "../canvas/resolvedWallFrame.js";
import { useDraftField } from "./useDraftField.js";
import { almostEqual, formatRounded, parseBoundedNumber } from "./numberDraft.js";

/**
 * Rotate a point around origin by the given angle in degrees. Used to
 * turn "length + angle" into an offset when appending a new wall from
 * the selected wall's B endpoint.
 */
function polarOffset(lengthCm: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad) * lengthCm, y: Math.sin(rad) * lengthCm };
}

export function WallPanel() {
  const { state, dispatch } = useProject();
  const wall = state.project.walls.find((w) => w.id === state.ui.selectedWallId) ?? null;
  const units = state.ui.units;
  const thicknessIsSet = wall !== null;
  const visibleThickness = wall
    ? displayedWallThickness(wall, state.project.layout, state.project.walls)
    : 0;

  // Numeric length draft — buffered so intermediate values (e.g. an
  // in-progress "40" typed toward "400") don't rewrite the wall on every
  // keystroke, and don't need clamping while typing.
  const currentLength = wall
    ? Math.round(Math.hypot(wall.innerLine[1].x - wall.innerLine[0].x, wall.innerLine[1].y - wall.innerLine[0].y))
    : 0;

  const lengthField = useDraftField<number>(currentLength, {
    parse: (raw) => parseBoundedNumber(raw, { min: 5 }),
    format: (n) => formatRounded(n),
    // Retyping the same integer length shouldn't re-dispatch a no-op wall edit.
    equals: (n, committed) => almostEqual(n, committed, 0.5),
    onCommit: (n) => {
      if (!wall) return;
      const [a, b] = wall.innerLine;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // Preserve direction; if the wall was zero-length (shouldn't happen)
      // fall back to +X so we don't divide by zero.
      const dx = len === 0 ? 1 : (b.x - a.x) / len;
      const dy = len === 0 ? 0 : (b.y - a.y) / len;
      const newB: Point = { x: Math.round(a.x + dx * n), y: Math.round(a.y + dy * n) };
      dispatch({ type: "update-wall", wallId: wall.id, patch: { innerLine: [a, newB] } });
    },
  });

  // Thickness gets the same buffering as length, and for the same reason: an
  // unbuffered field dispatched on every keystroke, so clearing it to retype
  // sent thickness 0 and each digit threw away the whole computed layout.
  const thicknessField = useDraftField<number>(visibleThickness, {
    parse: (raw) => parseBoundedNumber(raw, { min: MIN_WALL_THICKNESS_CM, max: MAX_WALL_THICKNESS_CM }),
    format: (n) => (wall && thicknessIsSet ? formatRounded(n, 1) : ""),
    equals: almostEqual,
    onCommit: (n) => {
      if (!wall) return;
      dispatch({ type: "update-wall", wallId: wall.id, patch: { thickness: n } });
    },
  });

  const [nextLength, setNextLength] = useState<string>("300");
  const [nextAngle, setNextAngle] = useState<string>("0");

  if (!wall) return null;

  const [a, b] = wall.innerLine;

  // On a two-contour plan the visible thickness is the live gap the user drew,
  // even before compute. Once the pair closes, the reducer stores this same
  // value on both source lines so display and persistence stay identical.
  const partner = wall.pairedWallId
    ? state.project.walls.find((w) => w.id === wall.pairedWallId)
    : undefined;
  const isPaired = !!wall.pairedWallId;
  const partnerMissing = isPaired && !partner;

  const addNextWall = () => {
    const len = Number(nextLength);
    const angle = Number(nextAngle);
    if (!Number.isFinite(len) || len < 5) return;
    if (!Number.isFinite(angle)) return;
    const offset = polarOffset(len, angle);
    const start: Point = { x: Math.round(b.x), y: Math.round(b.y) };
    const end: Point = { x: Math.round(b.x + offset.x), y: Math.round(b.y + offset.y) };
    dispatch({ type: "add-wall", a: start, b: end });
  };

  const onNextFieldKeyDown = (resetTo: string, setter: (v: string) => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    // Neither key blurs: keep focus in the field so Tab/Shift+Tab continues
    // from here rather than restarting from the top of the panel.
    if (e.key === "Enter") {
      e.preventDefault();
      addNextWall();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setter(resetTo);
    }
  };

  // The resolved wall this wall's placements live under — either the wall
  // itself, or (on a two-contour plan) the primary wall that consumed it.
  // `Placement.wallId` always names the primary/resolved wall id.
  const layout = state.project.layout;
  const resolvedWallId = layout?.resolvedWalls.find(
    (rw) => rw.id === wall.id || rw.consumedWallIds.includes(wall.id)
  )?.id;
  const wallTimber =
    layout && resolvedWallId
      ? countPanels(state.project.placements.filter((p) => p.wallId === resolvedWallId))
      : null;

  return (
    <section style={{ padding: 12, borderBottom: "1px solid #e2e8f0" }}>
      <h2 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
        קיר נבחר
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
        <Row label='אורך (ס"מ)'>
          <input
            type="number"
            min={5}
            value={lengthField.value}
            onChange={(e) => lengthField.onChange(e.target.value)}
            onBlur={lengthField.onBlur}
            onKeyDown={lengthField.onKeyDown}
            style={inputStyle}
          />
        </Row>
        {units === "m" && (
          <Row label="≈ במטרים">
            <span>{formatLength(Math.hypot(b.x - a.x, b.y - a.y), "m")}</span>
          </Row>
        )}
        <Row label="יציקה">
          <select
            value={wall.pourId}
            onChange={(e) =>
              dispatch({ type: "update-wall", wallId: wall.id, patch: { pourId: e.target.value } })
            }
            style={inputStyle}
          >
            {state.project.pours.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label='עובי (ס"מ)'>
          <input
            type="number"
            min={MIN_WALL_THICKNESS_CM}
            max={MAX_WALL_THICKNESS_CM}
            step={0.1}
            value={thicknessField.value}
            disabled={partnerMissing}
            onChange={(e) => thicknessField.onChange(e.target.value)}
            onBlur={thicknessField.onBlur}
            onKeyDown={thicknessField.onKeyDown}
            style={partnerMissing ? { ...inputStyle, background: "#f1f5f9", color: "#94a3b8" } : inputStyle}
          />
        </Row>
        <p style={{ margin: 0, fontSize: 11, color: partnerMissing ? "#b91c1c" : "#64748b", lineHeight: 1.4 }}>
          {partnerMissing
            ? "הקישור לקו השני אינו תקף — יש לחשב מחדש לפני שינוי העובי."
            : isPaired
              ? "העובי נמדד חי בין שני הקווים, גם לפני חישוב. שינוי כאן יזיז את הקו השני ויסגור מחדש את הפינות."
              : "העובי הוקלד. הפאה השנייה נגזרת ממנו. אפשר גם לגרור את הידית שעל קו המידה בקנבס."}
        </p>
        {wallTimber && (
          <Row label="עץ בקיר">
            <span>{`${wallTimber.timberPieces} חתיכות, ${wallTimber.timberLengthCm} ס"מ`}</span>
          </Row>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => dispatch({ type: "delete-wall", wallId: wall.id })}
          style={{ ...smallButton, background: "#fee2e2", color: "#b91c1c" }}
        >
          מחק קיר
        </button>
      </div>

      <div style={{ marginTop: 12, padding: 8, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4 }}>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>הוסף קיר המשך</div>
        <p style={{ margin: "0 0 6px 0", fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>
          מתחיל בקצה B של הקיר הנבחר. זווית: 0° = מזרח, 90° = דרום, ‑90° = צפון.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Row label='אורך (ס"מ)'>
            <input
              type="number"
              min={5}
              value={nextLength}
              onChange={(e) => setNextLength(e.target.value)}
              onKeyDown={onNextFieldKeyDown("300", setNextLength)}
              style={inputStyle}
            />
          </Row>
          <Row label="זווית (°)">
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="number"
                value={nextAngle}
                onChange={(e) => setNextAngle(e.target.value)}
                onKeyDown={onNextFieldKeyDown("0", setNextAngle)}
                style={{ ...inputStyle, width: 70 }}
              />
              <QuickAngle label="→" deg={0} onClick={setNextAngle} />
              <QuickAngle label="↓" deg={90} onClick={setNextAngle} />
              <QuickAngle label="←" deg={180} onClick={setNextAngle} />
              <QuickAngle label="↑" deg={-90} onClick={setNextAngle} />
            </div>
          </Row>
        </div>
        <button type="button" onClick={addNextWall} style={{ ...smallButton, marginTop: 8 }}>
          הוסף
        </button>
      </div>

      <p style={{ fontSize: 11, color: "#64748b", margin: "8px 0 0 0", lineHeight: 1.4 }}>
        קיצור: Delete / Backspace למחיקה מהירה.
      </p>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

function QuickAngle({ label, deg, onClick }: { label: string; deg: number; onClick: (v: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(String(deg))}
      style={{
        width: 22,
        height: 22,
        border: "1px solid #cbd5e1",
        borderRadius: 3,
        background: "#fff",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        lineHeight: 1,
      }}
      title={`${deg}°`}
    >
      {label}
    </button>
  );
}

const inputStyle: React.CSSProperties = { fontFamily: "inherit", fontSize: 12, padding: "3px 6px", border: "1px solid #cbd5e1", borderRadius: 3, width: 130 };
const smallButton: React.CSSProperties = { background: "#e2e8f0", border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" };
