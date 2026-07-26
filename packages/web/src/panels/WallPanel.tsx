import { useEffect, useState } from "react";
import type { Point } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { formatLength } from "../canvas/geometry.js";

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

  // Numeric length draft — buffered so intermediate values (e.g. an
  // in-progress "40" typed toward "400") don't rewrite the wall on every
  // keystroke, and don't need clamping while typing.
  const currentLength = wall
    ? Math.round(Math.hypot(wall.innerLine[1].x - wall.innerLine[0].x, wall.innerLine[1].y - wall.innerLine[0].y))
    : 0;
  const [lengthDraft, setLengthDraft] = useState<string>(String(currentLength));

  useEffect(() => {
    setLengthDraft(String(currentLength));
  }, [currentLength, wall?.id]);

  const [nextLength, setNextLength] = useState<string>("300");
  const [nextAngle, setNextAngle] = useState<string>("0");

  if (!wall) return null;

  const [a, b] = wall.innerLine;

  const commitLength = () => {
    const n = Number(lengthDraft);
    if (!Number.isFinite(n) || n < 5) {
      setLengthDraft(String(currentLength));
      return;
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // Preserve direction; if the wall was zero-length (shouldn't happen)
    // fall back to +X so we don't divide by zero.
    const dx = len === 0 ? 1 : (b.x - a.x) / len;
    const dy = len === 0 ? 0 : (b.y - a.y) / len;
    const newB: Point = { x: Math.round(a.x + dx * n), y: Math.round(a.y + dy * n) };
    dispatch({ type: "update-wall", wallId: wall.id, patch: { innerLine: [a, newB] } });
  };

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
            value={lengthDraft}
            onChange={(e) => setLengthDraft(e.target.value)}
            onBlur={commitLength}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
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
            min={5}
            max={80}
            value={wall.thickness}
            onChange={(e) =>
              dispatch({ type: "update-wall", wallId: wall.id, patch: { thickness: Number(e.target.value) } })
            }
            style={inputStyle}
          />
        </Row>
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
              style={inputStyle}
            />
          </Row>
          <Row label="זווית (°)">
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="number"
                value={nextAngle}
                onChange={(e) => setNextAngle(e.target.value)}
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
