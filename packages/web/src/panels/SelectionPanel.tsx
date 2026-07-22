import type { Placement } from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";

export function SelectionPanel() {
  const { state, dispatch } = useProject();
  const placement = state.project.placements.find((p) => p.id === state.ui.selectedPlacementId) ?? null;
  if (!placement) return null;

  // Only the straight, in-stock panels are legal swaps. Corner panels are
  // placed by the corners layer and can't be swapped for a straight panel.
  const swappableTypes = state.project.catalog.panels.filter(
    (p) => p.inStock && (placement.kind === "corner-panel" ? p.kind === "corner" : p.kind === "straight")
  );

  return (
    <section style={{ padding: 12, borderBottom: "1px solid #e2e8f0" }}>
      <h2 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
        פאנל נבחר
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
        <Row label="סוג">
          <select
            value={placement.panelType}
            onChange={(e) => {
              const panel = state.project.catalog.panels.find((p) => p.type === e.target.value);
              if (!panel) return;
              dispatch({
                type: "update-placement",
                placementId: placement.id,
                patch: { panelType: panel.type, width: panel.width, kind: panel.kind === "corner" ? "corner-panel" : "panel" },
              });
            }}
            style={inputStyle}
          >
            <option value="">(עץ / ללא)</option>
            {swappableTypes.map((p) => (
              <option key={p.type} value={p.type}>
                {p.type} · {p.width} ס"מ
              </option>
            ))}
          </select>
        </Row>
        <Row label="רוחב"><span>{placement.width} ס"מ</span></Row>
        <Row label="מיקום">
          <input
            type="number"
            value={Math.round(placement.offsetAlongEdge)}
            onChange={(e) =>
              dispatch({
                type: "update-placement",
                placementId: placement.id,
                patch: { offsetAlongEdge: Number(e.target.value) },
              })
            }
            style={inputStyle}
          />
        </Row>
        <Row label="צד">
          <span>{placement.side === "inner" ? "פנימי" : "חיצוני"}</span>
        </Row>
        <Row label="מקור">
          <span style={{ color: placement.source === "manual" ? "#b45309" : "#059669" }}>
            {placement.source === "manual" ? "ידני" : "אוטומטי"}
          </span>
        </Row>
        {placement.flags.length > 0 && (
          <div style={{ padding: 6, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>
            דגלים: {placement.flags.join(", ")}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => dispatch({ type: "delete-placement", placementId: placement.id })}
          style={{ ...smallButton, background: "#fee2e2", color: "#b91c1c" }}
        >
          מחק
        </button>
        <button
          type="button"
          onClick={() => duplicateAfter(placement, dispatch)}
          style={smallButton}
        >
          שכפל
        </button>
      </div>
    </section>
  );
}

function duplicateAfter(placement: Placement, dispatch: (a: { type: "insert-placement"; placement: Placement }) => void) {
  const copy: Placement = {
    ...placement,
    id: `${placement.id}:dup:${Date.now()}`,
    offsetAlongEdge: placement.offsetAlongEdge + placement.width,
    source: "manual",
    flags: [],
  };
  dispatch({ type: "insert-placement", placement: copy });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { fontFamily: "inherit", fontSize: 12, padding: "3px 6px", border: "1px solid #cbd5e1", borderRadius: 3, width: 130 };
const smallButton: React.CSSProperties = { background: "#e2e8f0", border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" };
