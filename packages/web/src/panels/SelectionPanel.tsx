import { JUNCTION_RESTRICTED_FLAG, type Placement } from "@rastoplan/core";

/** No `panelType`/catalog combination could fill the run at all — see selectPanels. */
const GAP_OUT_OF_RANGE_FLAG = "gap-out-of-range";
import { useProject } from "../state/ProjectContext.js";
import { duplicatePlacementId } from "../state/placementId.js";
import { useDraftField } from "./useDraftField.js";
import { formatRounded, parseBoundedNumber } from "./numberDraft.js";

export function SelectionPanel() {
  const { state, dispatch } = useProject();
  const placement = state.project.placements.find((p) => p.id === state.ui.selectedPlacementId) ?? null;

  // Buffered so intermediate keystrokes (e.g. clearing the field to retype)
  // never dispatch — an unbuffered field previously sent 0 on every clear,
  // marking the placement "manual" for no reason.
  const positionField = useDraftField<number>(placement?.offsetAlongEdge ?? 0, {
    // Negative offsets are valid on an outer face that wraps past a corner;
    // tileProject validates the committed integer against that face's actual
    // run on recompute rather than applying a wrong global minimum here.
    parse: (raw) => parseBoundedNumber(raw),
    format: (n) => formatRounded(n),
    // The field only ever shows/accepts whole centimeters, so two values that
    // round to the same displayed integer are "the same edit" for dispatch
    // purposes — this is what stops merely tabbing through the field (blur
    // always commits) from re-dispatching and marking an untouched placement
    // "manual".
    equals: (a, b) => Math.round(a) === Math.round(b),
    onCommit: (n) => {
      if (!placement) return;
      dispatch({
        type: "update-placement",
        placementId: placement.id,
        patch: { offsetAlongEdge: Math.round(n) },
      });
    },
  });

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
        {placement.kind === "timber" && (
          <Row label="אורך עץ">
            <span>{placement.width} ס"מ</span>
          </Row>
        )}
        <Row label="מיקום">
          <input
            type="number"
            value={positionField.value}
            onChange={(e) => positionField.onChange(e.target.value)}
            onBlur={positionField.onBlur}
            onKeyDown={positionField.onKeyDown}
            style={inputStyle}
          />
        </Row>
        <Row label="פאה">
          <span>{placement.side === "faceA" ? "פאה א׳" : "פאה ב׳"}</span>
        </Row>
        <Row label="צד">
          <span>{placement.faceIsInterior ? "פנימי (גובל בחדר)" : "חיצוני"}</span>
        </Row>
        <Row label="מקור">
          <span style={{ color: placement.source === "manual" ? "#b45309" : "#059669" }}>
            {placement.source === "manual" ? "ידני" : "אוטומטי"}
          </span>
        </Row>
        {placement.flags.includes(JUNCTION_RESTRICTED_FLAG) && (
          <div style={{ padding: 6, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11, color: "#b91c1c" }}>
            {placement.panelType} מותר רק בקיר שנגמר בצומת T. הוצב כאן ידנית — יש לוודא שזה מכוון.
          </div>
        )}
        {placement.flags.includes(GAP_OUT_OF_RANGE_FLAG) && (
          <div style={{ padding: 6, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11, color: "#b91c1c" }}>
            לא נמצא שילוב תבניות לקטע הזה — המרווח הדרוש חורג מטווח העץ המותר
            ({placement.width} ס"מ).
          </div>
        )}
        {placement.flags.some((f) => f !== JUNCTION_RESTRICTED_FLAG && f !== GAP_OUT_OF_RANGE_FLAG) && (
          <div style={{ padding: 6, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 11 }}>
            דגלים: {placement.flags.filter((f) => f !== JUNCTION_RESTRICTED_FLAG && f !== GAP_OUT_OF_RANGE_FLAG).join(", ")}
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
    id: duplicatePlacementId(placement),
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
