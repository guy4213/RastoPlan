import { useProject } from "../state/ProjectContext.js";

export function WallPanel() {
  const { state, dispatch } = useProject();
  const wall = state.project.walls.find((w) => w.id === state.ui.selectedWallId) ?? null;
  if (!wall) return null;

  const [a, b] = wall.innerLine;
  const length = Math.round(Math.hypot(b.x - a.x, b.y - a.y));

  return (
    <section style={{ padding: 12, borderBottom: "1px solid #e2e8f0" }}>
      <h2 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
        קיר נבחר
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
        <Row label="אורך"><span>{length} ס"מ</span></Row>
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

const inputStyle: React.CSSProperties = { fontFamily: "inherit", fontSize: 12, padding: "3px 6px", border: "1px solid #cbd5e1", borderRadius: 3, width: 130 };
const smallButton: React.CSSProperties = { background: "#e2e8f0", border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" };
