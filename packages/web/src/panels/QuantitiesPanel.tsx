import { useMemo } from "react";
import {
  ACCESSORY_ITEMS,
  applyQuantityOverrides,
  buildBomTemplate,
  countAccessoriesByPour,
  countPanelsByPour,
  type AccessoryCount,
  type PanelCount,
  type Project,
  type QuantityOverrides,
} from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { downloadBomXlsx } from "../export/writeBomXlsx.js";

/** The two rows the customer's own sheets type by hand — see docs/open-questions.md §3. */
const OVERRIDABLE_ROWS = new Set<keyof AccessoryCount>(["cornerClamps", "straightClamps"]);

export function QuantitiesPanel() {
  const { state, dispatch } = useProject();
  const { project } = state;

  const { accessories, automatic, panels, pourNames, totalPourIds } = useMemo(() => {
    const empty = {
      accessories: { byPour: {}, total: emptyAccessory() },
      automatic: { byPour: {}, total: emptyAccessory() },
      panels: { byPour: {}, total: { byType: {}, timberPieces: 0, timberLengthCm: 0 } },
      pourNames: new Map<string, string>(),
      totalPourIds: [] as string[],
    };
    // Read the engine's own layout rather than re-deriving the graph here —
    // a second copy of the pipeline in the UI silently drifts from the real one.
    if (project.walls.length === 0 || !project.layout) return empty;

    const automatic = countAccessoriesByPour(
      project.placements,
      project.layout.edges,
      project.walls,
      project.rules
    );
    return {
      accessories: applyQuantityOverrides(automatic, project.overrides).counts,
      automatic,
      panels: countPanelsByPour(project.placements, project.walls),
      pourNames: new Map(project.pours.map((p) => [p.id, p.name])),
      totalPourIds: project.pours.map((p) => p.id),
    };
  }, [project]);

  const hasPlacements = project.placements.length > 0 && !!project.layout;
  const diagnostics = project.layout?.diagnostics ?? [];

  function setOverride(field: keyof QuantityOverrides, pourId: string, value: number | null) {
    dispatch({ type: "set-quantity-override", field, pourId, value });
  }

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

      {diagnostics.length > 0 && <Diagnostics items={diagnostics} />}

      {hasPlacements && (
        <>
          <SectionHeader>אביזרים</SectionHeader>
          <QuantityTable
            perPourIds={totalPourIds}
            perPour={accessories.byPour}
            automaticPerPour={automatic.byPour}
            total={accessories.total}
            pourNames={pourNames}
            rows={ACCESSORY_ROWS}
            overrides={project.overrides}
            onOverride={setOverride}
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
  automaticPerPour,
  total,
  pourNames,
  rows,
  overrides,
  onOverride,
}: {
  perPourIds: string[];
  perPour: Record<string, AccessoryCount>;
  automaticPerPour: Record<string, AccessoryCount>;
  total: AccessoryCount;
  pourNames: Map<string, string>;
  rows: Row<K>[];
  overrides: QuantityOverrides | undefined;
  onOverride: (field: keyof QuantityOverrides, pourId: string, value: number | null) => void;
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
        {rows.map((row) => {
          const editable = OVERRIDABLE_ROWS.has(row.key);
          const field = row.key as keyof QuantityOverrides;
          return (
            <tr key={String(row.key)}>
              <td style={tdLabelStyle}>{row.label}</td>
              {perPourIds.map((id) => {
                const automatic = automaticPerPour[id]?.[row.key] ?? 0;
                const override = overrides?.[field]?.[id];
                const isOverridden = editable && typeof override === "number";
                if (!editable) {
                  return <td key={id} style={tdStyle}>{perPour[id]?.[row.key] ?? 0}</td>;
                }
                return (
                  <td
                    key={id}
                    style={{ ...tdStyle, background: isOverridden ? "#fef3c7" : undefined }}
                  >
                    <input
                      type="number"
                      min={0}
                      value={isOverridden ? String(override) : ""}
                      placeholder={String(automatic)}
                      title={`אוטומטי: ${automatic}`}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        onOverride(field, id, raw === "" ? null : Number(raw));
                      }}
                      style={{
                        ...overrideInputStyle,
                        color: isOverridden ? "#78350f" : "#0f172a",
                        fontWeight: isOverridden ? 600 : 400,
                      }}
                    />
                    {isOverridden && (
                      <button
                        type="button"
                        title="חזרה לחישוב אוטומטי"
                        onClick={() => onOverride(field, id, null)}
                        style={resetButtonStyle}
                      >
                        ↺
                      </button>
                    )}
                  </td>
                );
              })}
              <td style={{ ...tdStyle, fontWeight: 600, background: "#f1f5f9" }}>{total[row.key]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const DIAGNOSTIC_COLORS = {
  error: { background: "#fee2e2", border: "#b91c1c", text: "#7f1d1d" },
  warning: { background: "#fef3c7", border: "#b45309", text: "#78350f" },
  info: { background: "#e0e7ff", border: "#4f46e5", text: "#3730a3" },
} as const;

/**
 * What the engine could not decide on its own. Two contours 30cm apart are a
 * wall or a duct depending on knowledge the drawing doesn't carry, so the
 * pairings it made are listed for the engineer to eyeball rather than trusted
 * silently.
 */
function Diagnostics({ items }: { items: NonNullable<Project["layout"]>["diagnostics"] }) {
  const ordered = ["error", "warning", "info"] as const;
  const sorted = [...items].sort(
    (a, b) => ordered.indexOf(a.severity) - ordered.indexOf(b.severity)
  );
  return (
    <>
      <SectionHeader>הערות מנוע</SectionHeader>
      <div style={{ padding: "8px 12px", display: "grid", gap: 6 }}>
        {sorted.map((d, i) => {
          const colors = DIAGNOSTIC_COLORS[d.severity];
          return (
            <div
              key={`${d.code}:${i}`}
              style={{
                fontSize: 11,
                lineHeight: 1.5,
                padding: "6px 8px",
                borderRadius: 4,
                background: colors.background,
                color: colors.text,
                borderInlineStart: `3px solid ${colors.border}`,
              }}
            >
              {d.message}
            </div>
          );
        })}
      </div>
    </>
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

const overrideInputStyle: React.CSSProperties = {
  width: 46,
  padding: "1px 2px",
  fontSize: 12,
  textAlign: "center",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 3,
};

const resetButtonStyle: React.CSSProperties = {
  marginInlineStart: 2,
  padding: 0,
  width: 14,
  fontSize: 10,
  lineHeight: 1,
  color: "#b45309",
  background: "transparent",
  border: "none",
  cursor: "pointer",
};

const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const thStyle: React.CSSProperties = { padding: "4px 8px", textAlign: "center", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: "4px 8px", textAlign: "center", borderBottom: "1px solid #f1f5f9" };
const tdLabelStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", color: "#475569" };
