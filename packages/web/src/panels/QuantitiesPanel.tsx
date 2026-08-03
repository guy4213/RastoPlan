import { useMemo } from "react";
import {
  ACCESSORY_ITEMS,
  buildBomTemplate,
  buildGraph,
  classifyCornerSides,
  classifyNodes,
  countAccessoriesByPour,
  countPanelsByPour,
  placeCornerPanels,
  type AccessoryCount,
  type PanelCount,
} from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { downloadBomXlsx } from "../export/writeBomXlsx.js";

/** Runs the graph pipeline just far enough to feed the accessory counter. */
function computeGraph(project: ReturnType<typeof useProject>["state"]["project"]) {
  const { nodes, edges } = buildGraph(project.walls);
  const classified = classifyCornerSides(classifyNodes(nodes, edges), edges);
  const corners = placeCornerPanels(classified, edges, project.walls, project.catalog, project.rules);
  return { nodes: classified, edges: corners.edges };
}

export function QuantitiesPanel() {
  const { state } = useProject();
  const { project } = state;

  const { accessories, panels, pourNames, totalPourIds } = useMemo(() => {
    if (project.walls.length === 0) {
      return {
        accessories: { byPour: {}, total: emptyAccessory() },
        panels: { byPour: {}, total: { byType: {}, timberPieces: 0, timberLengthCm: 0 } },
        pourNames: new Map<string, string>(),
        totalPourIds: [] as string[],
      };
    }
    const graph = computeGraph(project);
    const accessories = countAccessoriesByPour(
      project.placements,
      graph.edges,
      project.walls,
      project.rules
    );
    const panels = countPanelsByPour(project.placements, project.walls);
    const pourNames = new Map(project.pours.map((p) => [p.id, p.name]));
    const totalPourIds = project.pours.map((p) => p.id);
    return { accessories, panels, pourNames, totalPourIds };
  }, [project]);

  const hasPlacements = project.placements.length > 0;

  async function exportBom() {
    const template = buildBomTemplate({
      header: {
        companyName: "",
        projectName: project.name,
        note: "קומה טיפוסית",
        date: new Date().toLocaleDateString("he-IL"),
      },
      catalog: project.catalog,
      pourIds: totalPourIds,
      pourNames: totalPourIds.map((id) => pourNames.get(id) ?? id),
      panels,
      accessories,
    });
    await downloadBomXlsx(template, `חישוב כמויות — ${project.name}`);
  }

  return (
    <aside style={{ overflow: "auto", direction: "rtl" }}>
      <div style={{ padding: 12, borderBottom: "1px solid #e2e8f0" }}>
        <h2 style={{ margin: "0 0 4px 0", fontSize: 14, fontWeight: 600 }}>כמויות</h2>
        <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>
          מתעדכן חי לכל שינוי בקנבס. כשאין פריסה עדיין — הרץ "חשב".
        </p>
        {hasPlacements && (
          <button type="button" onClick={exportBom} style={exportButtonStyle}>
            ייצוא BOM לאקסל
          </button>
        )}
      </div>

      {!hasPlacements && (
        <div style={{ padding: 12, fontSize: 12, color: "#94a3b8" }}>
          עוד לא רצה מנוע. אביזרים ופאנלים יופיעו אחרי לחיצה על "חשב".
        </div>
      )}

      {hasPlacements && (
        <>
          <SectionHeader>אביזרים</SectionHeader>
          <QuantityTable
            perPourIds={totalPourIds}
            perPour={accessories.byPour}
            total={accessories.total}
            pourNames={pourNames}
            rows={ACCESSORY_ROWS}
          />

          <SectionHeader>פאנלים</SectionHeader>
          <PanelTable
            perPourIds={totalPourIds}
            perPour={panels.byPour}
            total={panels.total}
            pourNames={pourNames}
          />
        </>
      )}
    </aside>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "8px 12px", background: "#f1f5f9", fontSize: 12, fontWeight: 600, color: "#0f172a", borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
      {children}
    </div>
  );
}

interface Row<K> {
  key: K;
  label: string;
}

const ACCESSORY_ROWS: Row<keyof AccessoryCount>[] = [
  { key: "cornerClamps", label: `קלמרות פינה (${ACCESSORY_ITEMS.cornerClamp.code})` },
  { key: "straightClamps", label: `קלמרות ישרות (${ACCESSORY_ITEMS.straightClamp.code})` },
  { key: "dywidagRods", label: "Dywidag" },
  { key: "dywidagRodsStandard", label: "‏— מוט 1 מ׳" },
  { key: "dywidagRodsLong", label: "‏— מוט ארוך (עובי > 30)" },
  { key: "nuts", label: `אומים ${ACCESSORY_ITEMS.nut.code}` },
  { key: "struts", label: "רגלי תמיכה + הליכון" },
  { key: "craneAdapters", label: "מתאמי מנוף" },
];

function QuantityTable<K extends keyof AccessoryCount>({
  perPourIds,
  perPour,
  total,
  pourNames,
  rows,
}: {
  perPourIds: string[];
  perPour: Record<string, AccessoryCount>;
  total: AccessoryCount;
  pourNames: Map<string, string>;
  rows: Row<K>[];
}) {
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>פריט</th>
          {perPourIds.map((id) => (
            <th key={id} style={thStyle}>{pourNames.get(id) ?? id}</th>
          ))}
          <th style={{ ...thStyle, background: "#e2e8f0" }}>סה"כ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row.key)}>
            <td style={tdLabelStyle}>{row.label}</td>
            {perPourIds.map((id) => (
              <td key={id} style={tdStyle}>{perPour[id]?.[row.key] ?? 0}</td>
            ))}
            <td style={{ ...tdStyle, fontWeight: 600, background: "#f1f5f9" }}>{total[row.key]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PanelTable({
  perPourIds,
  perPour,
  total,
  pourNames,
}: {
  perPourIds: string[];
  perPour: Record<string, PanelCount>;
  total: PanelCount;
  pourNames: Map<string, string>;
}) {
  const allTypes = Object.keys(total.byType).sort();
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>סוג</th>
          {perPourIds.map((id) => (
            <th key={id} style={thStyle}>{pourNames.get(id) ?? id}</th>
          ))}
          <th style={{ ...thStyle, background: "#e2e8f0" }}>סה"כ</th>
        </tr>
      </thead>
      <tbody>
        {allTypes.map((type) => (
          <tr key={type}>
            <td style={tdLabelStyle}>{type}</td>
            {perPourIds.map((id) => (
              <td key={id} style={tdStyle}>{perPour[id]?.byType[type] ?? 0}</td>
            ))}
            <td style={{ ...tdStyle, fontWeight: 600, background: "#f1f5f9" }}>{total.byType[type] ?? 0}</td>
          </tr>
        ))}
        <tr>
          <td style={tdLabelStyle}>עץ (חתיכות)</td>
          {perPourIds.map((id) => (
            <td key={id} style={tdStyle}>{perPour[id]?.timberPieces ?? 0}</td>
          ))}
          <td style={{ ...tdStyle, fontWeight: 600, background: "#f1f5f9" }}>{total.timberPieces}</td>
        </tr>
        <tr>
          <td style={tdLabelStyle}>עץ (ס"מ)</td>
          {perPourIds.map((id) => (
            <td key={id} style={tdStyle}>{perPour[id]?.timberLengthCm ?? 0}</td>
          ))}
          <td style={{ ...tdStyle, fontWeight: 600, background: "#f1f5f9" }}>{total.timberLengthCm}</td>
        </tr>
      </tbody>
    </table>
  );
}

function emptyAccessory(): AccessoryCount {
  return {
    cornerClamps: 0,
    straightClamps: 0,
    dywidagRods: 0,
    dywidagRodsStandard: 0,
    dywidagRodsLong: 0,
    nuts: 0,
    struts: 0,
    craneAdapters: 0,
  };
}

const exportButtonStyle: React.CSSProperties = {
  marginTop: 8,
  width: "100%",
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#0f172a",
  background: "#f1f5f9",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  cursor: "pointer",
};

const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const thStyle: React.CSSProperties = { padding: "4px 8px", textAlign: "center", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "4px 8px", textAlign: "center", borderBottom: "1px solid #f1f5f9" };
const tdLabelStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", color: "#475569" };
