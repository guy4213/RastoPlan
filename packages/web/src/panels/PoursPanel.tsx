import { useProject } from "../state/ProjectContext.js";

export function PoursPanel() {
  const { state, dispatch } = useProject();
  const { pours } = state.project;
  const { activePourId, selectedWallId } = state.ui;
  const selectedWall = state.project.walls.find((w) => w.id === selectedWallId) ?? null;

  return (
    <section style={sectionStyle}>
      <header style={headerRow}>
        <h2 style={h2Style}>יציקות</h2>
        <button type="button" onClick={() => dispatch({ type: "add-pour" })} style={smallButton}>
          + יציקה
        </button>
      </header>
      <p style={hintStyle}>
        בחר יציקה פעילה — קירות חדשים שתצייר ישויכו אליה. שנה שיוך של קיר קיים מפאנל הבחירה למטה.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {pours.map((pour) => {
          const isActive = pour.id === activePourId;
          return (
            <li
              key={pour.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                background: isActive ? "#eef2ff" : "transparent",
                border: `1px solid ${isActive ? "#6366f1" : "#e2e8f0"}`,
                borderRadius: 4,
                marginBottom: 6,
              }}
            >
              <button
                type="button"
                onClick={() => dispatch({ type: "set-active-pour", pourId: pour.id })}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  flex: 1,
                  textAlign: "right",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    background: pour.color,
                    flexShrink: 0,
                  }}
                />
                <input
                  type="text"
                  value={pour.name}
                  onChange={(e) =>
                    dispatch({ type: "update-pour", pourId: pour.id, patch: { name: e.target.value } })
                  }
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1,
                    border: "none",
                    background: "transparent",
                    fontSize: 14,
                    fontFamily: "inherit",
                    textAlign: "right",
                    color: "inherit",
                  }}
                />
              </button>
              <input
                type="color"
                value={pour.color}
                onChange={(e) =>
                  dispatch({ type: "update-pour", pourId: pour.id, patch: { color: e.target.value } })
                }
                style={{ width: 24, height: 24, border: "none", background: "none", padding: 0 }}
              />
              {pours.length > 1 && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "delete-pour", pourId: pour.id })}
                  style={{ ...smallButton, color: "#b91c1c" }}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {selectedWall && (
        <div style={{ ...cardStyle, marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>הקיר הנבחר</div>
          <label style={labelRow}>
            <span>יציקה</span>
            <select
              value={selectedWall.pourId}
              onChange={(e) =>
                dispatch({
                  type: "update-wall",
                  wallId: selectedWall.id,
                  patch: { pourId: e.target.value },
                })
              }
              style={inputStyle}
            >
              {pours.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label style={labelRow}>
            <span>עובי (ס"מ)</span>
            <input
              type="number"
              min={5}
              max={80}
              value={selectedWall.thickness}
              onChange={(e) =>
                dispatch({
                  type: "update-wall",
                  wallId: selectedWall.id,
                  patch: { thickness: Number(e.target.value) },
                })
              }
              style={inputStyle}
            />
          </label>
          <button
            type="button"
            onClick={() => dispatch({ type: "delete-wall", wallId: selectedWall.id })}
            style={{ ...smallButton, background: "#fee2e2", color: "#b91c1c", marginTop: 8 }}
          >
            מחק קיר
          </button>
        </div>
      )}
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #e2e8f0",
};
const headerRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 };
const h2Style: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600, color: "#0f172a" };
const smallButton: React.CSSProperties = { background: "#e2e8f0", border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" };
const hintStyle: React.CSSProperties = { fontSize: 11, color: "#64748b", margin: "0 0 8px 0", lineHeight: 1.4 };
const cardStyle: React.CSSProperties = { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4, padding: 8 };
const labelRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, marginBottom: 6 };
const inputStyle: React.CSSProperties = { fontFamily: "inherit", fontSize: 12, padding: "3px 6px", border: "1px solid #cbd5e1", borderRadius: 3, width: 90 };
