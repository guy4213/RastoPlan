import { useProject } from "../state/ProjectContext.js";

export function Toolbar() {
  const { state, dispatch } = useProject();
  const { tool, layoutDirty } = state.ui;

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
          בחירה
        </ToolButton>
        <ToolButton active={tool === "draw-wall"} onClick={() => dispatch({ type: "set-tool", tool: "draw-wall" })}>
          צייר קיר
        </ToolButton>
      </div>

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
      }}
    >
      {children}
    </button>
  );
}
