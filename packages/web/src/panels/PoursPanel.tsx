import { useProject } from "../state/ProjectContext.js";

export function PoursPanel() {
  const { state, dispatch } = useProject();
  const { pours } = state.project;
  const { activePourId } = state.ui;

  return (
    <section style={sectionStyle}>
      <header style={headerRow}>
        <h2 style={h2Style}>יציקות</h2>
        <button type="button" onClick={() => dispatch({ type: "add-pour" })} style={smallButton}>
          + יציקה
        </button>
      </header>
      <p style={hintStyle}>
        בחר יציקה פעילה — קירות חדשים שתצייר ישויכו אליה. שנה שיוך של קיר קיים בפאנל "קיר נבחר".
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {pours.map((pour) => {
          const isActive = pour.id === activePourId;
          const selectPour = () =>
            dispatch({ type: "set-active-pour", pourId: pour.id });
          return (
            <li
              key={pour.id}
              onClick={selectPour}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                background: isActive ? "#eef2ff" : "transparent",
                border: `1px solid ${isActive ? "#6366f1" : "#e2e8f0"}`,
                borderRadius: 4,
                marginBottom: 6,
                cursor: "pointer",
              }}
            >
              <button
                type="button"
                aria-pressed={isActive}
                aria-label={`בחר ${pour.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  selectPour();
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: isActive ? "#6366f1" : "#fff",
                  border: `2px solid ${isActive ? "#4f46e5" : "#94a3b8"}`,
                  padding: 0,
                  cursor: "pointer",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {isActive && (
                  <span style={{ color: "#fff", fontSize: 13, lineHeight: 1 }}>✓</span>
                )}
              </button>
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
                onFocus={selectPour}
                onChange={(e) =>
                  dispatch({ type: "update-pour", pourId: pour.id, patch: { name: e.target.value } })
                }
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: "none",
                  background: "transparent",
                  fontSize: 14,
                  fontFamily: "inherit",
                  textAlign: "right",
                  color: "inherit",
                }}
              />
              {isActive && (
                <span
                  style={{
                    padding: "2px 6px",
                    borderRadius: 10,
                    background: "#c7d2fe",
                    color: "#3730a3",
                    fontSize: 10,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  פעילה
                </span>
              )}
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
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch({ type: "delete-pour", pourId: pour.id });
                  }}
                  style={{ ...smallButton, color: "#b91c1c" }}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
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
