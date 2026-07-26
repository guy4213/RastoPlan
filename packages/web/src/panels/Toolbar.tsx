import { useState } from "react";
import type { Point } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";

interface FreeEndpoint {
  wallId: string;
  end: 0 | 1;
  point: Point;
}

/**
 * Endpoints touched by exactly one wall in the given set — the open
 * ends of a chain. Uses a small tolerance because a cm-rounded endpoint
 * from an old drag might differ from a fresh one by less than a cm.
 */
function findFreeEndpoints(walls: { id: string; innerLine: [Point, Point] }[]): FreeEndpoint[] {
  const TOL = 1; // cm
  const all: FreeEndpoint[] = [];
  for (const w of walls) {
    all.push({ wallId: w.id, end: 0, point: w.innerLine[0] });
    all.push({ wallId: w.id, end: 1, point: w.innerLine[1] });
  }
  return all.filter((ep) => {
    let touches = 0;
    for (const other of all) {
      if (Math.hypot(other.point.x - ep.point.x, other.point.y - ep.point.y) <= TOL) touches++;
    }
    // "touches" counts ep itself too, so 1 = only touches itself = free.
    return touches === 1;
  });
}

export function Toolbar() {
  const { state, dispatch } = useProject();
  const { tool, layoutDirty, activePourId } = state.ui;
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const closeActiveRoom = () => {
    if (!activePourId) return;
    const wallsInPour = state.project.walls.filter((w) => w.pourId === activePourId);
    if (wallsInPour.length < 2) {
      showNotice("צריך לפחות שני קירות ביציקה הפעילה");
      return;
    }
    const free = findFreeEndpoints(wallsInPour);
    if (free.length === 0) {
      showNotice("החדר כבר סגור");
      return;
    }
    if (free.length !== 2) {
      showNotice(`${free.length} קצוות פתוחים — סגור ידנית עם כלי החיבור`);
      return;
    }
    const a = free[0]!;
    const b = free[1]!;
    dispatch({
      type: "add-wall",
      a: { x: Math.round(a.point.x), y: Math.round(a.point.y) },
      b: { x: Math.round(b.point.x), y: Math.round(b.point.y) },
    });
  };

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        borderBottom: "1px solid #e2e8f0",
        background: "#fff",
      }}
    >
      <input
        type="text"
        value={state.project.name}
        onChange={(e) => dispatch({ type: "rename-project", name: e.target.value })}
        style={{
          fontSize: 15,
          fontWeight: 600,
          border: "1px solid transparent",
          padding: "4px 8px",
          borderRadius: 4,
          fontFamily: "inherit",
          background: "#f8fafc",
          color: "#0f172a",
          minWidth: 200,
        }}
      />

      <div style={{ display: "flex", gap: 4, marginInlineStart: 8 }}>
        <ToolButton active={tool === "select"} onClick={() => dispatch({ type: "set-tool", tool: "select" })}>
          בחירה <Hotkey>V</Hotkey>
        </ToolButton>
        <ToolButton active={tool === "draw-wall"} onClick={() => dispatch({ type: "set-tool", tool: "draw-wall" })}>
          צייר קיר <Hotkey>D</Hotkey>
        </ToolButton>
        <ToolButton active={tool === "weld"} onClick={() => dispatch({ type: "set-tool", tool: "weld" })}>
          חבר קצוות <Hotkey>W</Hotkey>
        </ToolButton>
        <button type="button" onClick={closeActiveRoom} style={secondaryButton}>
          סגור חדר
        </button>
      </div>

      {tool === "draw-wall" && (
        <span style={{ fontSize: 11, color: "#64748b" }}>
          גרירה או קליק-קליק · Shift = אורתוגונלי · Escape / קליק ימני = ביטול
        </span>
      )}
      {tool === "select" && (
        <span style={{ fontSize: 11, color: "#64748b" }}>
          קליק = בחירה · Shift+גרירה = חלון בחירה · גרירה = הזזה · Delete = מחיקה
        </span>
      )}
      {tool === "weld" && (
        <span style={{ fontSize: 11, color: "#64748b" }}>
          קליק על שני קצוות → מיזוג לפינה משותפת
        </span>
      )}
      {notice && (
        <span style={{ fontSize: 12, color: "#b45309", marginInlineStart: 8 }}>{notice}</span>
      )}

      <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {layoutDirty && state.project.walls.length > 0 && (
          <span style={{ fontSize: 12, color: "#b45309" }}>הפריסה אינה מעודכנת</span>
        )}
        <button
          type="button"
          disabled={state.project.walls.length === 0}
          onClick={() => dispatch({ type: "compute" })}
          style={{
            padding: "8px 16px",
            background: state.project.walls.length === 0 ? "#e2e8f0" : "#0f172a",
            color: state.project.walls.length === 0 ? "#94a3b8" : "#fff",
            border: "none",
            borderRadius: 4,
            fontWeight: 600,
            cursor: state.project.walls.length === 0 ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          חשב
        </button>
      </div>
    </header>
  );
}

function ToolButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        background: active ? "#0f172a" : "#f1f5f9",
        color: active ? "#fff" : "#0f172a",
        border: "none",
        borderRadius: 4,
        fontFamily: "inherit",
        fontSize: 13,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
    </button>
  );
}

function Hotkey({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        background: "rgba(255,255,255,0.15)",
        border: "1px solid rgba(255,255,255,0.25)",
        color: "inherit",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {children}
    </kbd>
  );
}

const secondaryButton: React.CSSProperties = {
  padding: "6px 12px",
  background: "#eff6ff",
  color: "#1e40af",
  border: "1px solid #bfdbfe",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 13,
  cursor: "pointer",
};
