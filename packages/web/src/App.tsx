import { ProjectProvider } from "./state/ProjectContext.js";
import { Canvas } from "./canvas/Canvas.js";
import { Toolbar } from "./panels/Toolbar.js";
import { PoursPanel } from "./panels/PoursPanel.js";
import { SelectionPanel } from "./panels/SelectionPanel.js";
import { WallPanel } from "./panels/WallPanel.js";
import { QuantitiesPanel } from "./panels/QuantitiesPanel.js";
import { Legend } from "./panels/Legend.js";
import { ToastProvider } from "./ui/Toast.js";

export function App() {
  return (
    <ToastProvider>
    <ProjectProvider>
      <div
        dir="rtl"
        style={{
          height: "100vh",
          display: "grid",
          gridTemplateRows: "auto 1fr",
          gridTemplateColumns: "260px 1fr 300px",
          gridTemplateAreas: `
            "toolbar toolbar toolbar"
            "left    canvas  right"
          `,
          fontFamily: "system-ui, -apple-system, Segoe UI, Arial, sans-serif",
          color: "#0f172a",
          background: "#fff",
        }}
      >
        <div style={{ gridArea: "toolbar" }}>
          <Toolbar />
        </div>
        <aside
          style={{
            gridArea: "left",
            borderInlineEnd: "1px solid #e2e8f0",
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            direction: "rtl",
          }}
        >
          <PoursPanel />
          <WallPanel />
          <SelectionPanel />
          <Legend />
        </aside>
        <div style={{ gridArea: "canvas", overflow: "hidden", display: "flex" }}>
          <Canvas />
        </div>
        <aside
          style={{
            gridArea: "right",
            minHeight: 0,
            borderInlineStart: "1px solid #e2e8f0",
            overflow: "hidden",
          }}
        >
          <QuantitiesPanel />
        </aside>
      </div>
    </ProjectProvider>
    </ToastProvider>
  );
}
