import { useMemo, useRef, useState } from "react";
import type { CadUnit, Pour, Project } from "@rastoplan/core";
import {
  boundsOf,
  clusterPours,
  measureThickness,
  pickUnit,
  segmentsToWalls,
} from "@rastoplan/core";
import { useProject } from "../state/ProjectContext.js";
import { PALETTE } from "../state/project.js";
import { readCadFile, type ReadResult, type ReadStage } from "../cad/readDwg.js";

interface Props {
  open: boolean;
  onClose: () => void;
}

const UNITS: { value: CadUnit; label: string }[] = [
  { value: "mm", label: 'מ"מ' },
  { value: "cm", label: 'ס"מ' },
  { value: "m", label: "מ'" },
];

const STAGE_LABEL: Record<ReadStage, string> = {
  "loading-engine": "טוען את מנוע הקריאה...",
  parsing: "מפענח את הקובץ...",
  flattening: "מחלץ את הקווים...",
};

/**
 * Import a DWG/DXF drawing as walls.
 *
 * There is nothing to choose: the whole drawing comes in, the scale is worked
 * out from the geometry, and each spatially separate structure becomes its own
 * pour. The only control is the unit, because a drawing that is out by a factor
 * of ten still looks perfectly reasonable until you check the number.
 */
export function ImportCadModal({ open, onClose }: Props) {
  const { state, dispatch } = useProject();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ReadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [unit, setUnit] = useState<CadUnit>("cm");
  const [thickness, setThickness] = useState(20);

  const preview = useMemo(() => {
    if (!result || result.segments.length === 0) return null;
    const groups = clusterPours(result.segments, unit);

    // Convert once here so the dialog can report what will actually happen —
    // including the thicknesses read off the drawing — rather than promising
    // something the import might not deliver.
    const pourByLayer: Record<string, string> = {};
    const tagged = groups.flatMap((group, i) => {
      const key = `__pour${i}`;
      pourByLayer[key] = key;
      return group.map((s) => ({ ...s, layer: key }));
    });
    const { walls: rawWalls } = segmentsToWalls(tagged, {
      pourByLayer,
      unit,
      thicknessCm: thickness,
      makeId: (i) => `preview-${i}`,
    });
    const { walls, measured } = measureThickness(rawWalls);
    const thicknesses = [...new Set(walls.map((w) => w.thickness))].sort((a, b) => a - b);

    return {
      bounds: boundsOf(result.segments, unit),
      groups,
      wallCount: walls.length,
      measured,
      thicknesses,
    };
  }, [result, unit, thickness]);

  function reset() {
    setFileName(null);
    setResult(null);
    setError(null);
    setStage(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    setStage("loading-engine");
    try {
      const read = await readCadFile(file, setStage);
      if (read.segments.length === 0) {
        setError("לא נמצאו קווים בקובץ. ייתכן שהתוכן נמצא בקבצים מקושרים (XREF).");
      }
      setResult(read);
      setUnit(pickUnit(read.segments, read.suggestedUnit));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  function handleImport() {
    if (!result || !preview) return;

    const pours: Pour[] = preview.groups.map((_, i) => ({
      id: `pour-${Math.random().toString(36).slice(2, 9)}`,
      name: `יציקה ${i + 1}`,
      color: PALETTE[i % PALETTE.length]!,
      order: i,
    }));

    // Route each cluster to its own pour by relabelling copies of its segments.
    // Copies, not the originals: the preview is recomputed whenever the unit
    // changes, and mutating the parsed result would poison it.
    // All clusters go through one conversion so they share a single coordinate
    // shift — converting them separately would stack the pours on each other.
    const pourByLayer: Record<string, string> = {};
    const tagged = preview.groups.flatMap((group, i) => {
      const key = `__pour${i}`;
      pourByLayer[key] = pours[i]!.id;
      return group.map((s) => ({ ...s, layer: key }));
    });

    const { walls: rawWalls, offsetCm } = segmentsToWalls(tagged, {
      pourByLayer,
      unit,
      // Only a fallback: every wall whose opposite face is found in the drawing
      // gets its real thickness measured instead.
      thicknessCm: thickness,
      makeId: (i) => `wall-${i}-${Math.random().toString(36).slice(2, 7)}`,
    });

    if (rawWalls.length === 0) {
      setError("לא נוצרו קירות. נסה יחידת מידה אחרת.");
      return;
    }

    const { walls } = measureThickness(rawWalls);

    const next: Project = {
      ...state.project,
      name: fileName ? fileName.replace(/\.(dwg|dxf)$/i, "") : state.project.name,
      pours,
      walls,
      placements: [],
      layout: undefined,
      // Remember where the drawing really sat, so the DXF export can put the
      // result back on the source drawing's coordinates.
      cadOffsetCm: offsetCm,
      updatedAt: new Date().toISOString(),
    };

    dispatch({ type: "load-project", project: next });
    handleClose();
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.35)",
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        direction: "rtl",
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          background: "#fff",
          borderRadius: 8,
          boxShadow: "0 20px 40px rgba(15, 23, 42, 0.2)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "inherit",
        }}
      >
        <header
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>ייבוא שרטוט</h2>
          <button type="button" onClick={handleClose} style={closeButton} aria-label="סגור">
            ×
          </button>
        </header>

        <div style={{ padding: 16 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".dwg,.dxf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              style={primaryButton}
            >
              בחר קובץ DWG / DXF
            </button>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {busy ? STAGE_LABEL[stage ?? "loading-engine"] : (fileName ?? "לא נבחר קובץ")}
            </span>
          </div>
          {busy && (
            <div style={{ fontSize: 11, color: "#b45309", marginTop: 8 }}>
              קובץ גדול יכול לקחת דקה או שתיים.
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              padding: "10px 16px",
              background: "#fef2f2",
              color: "#b91c1c",
              fontSize: 12,
              borderTop: "1px solid #fecaca",
            }}
          >
            {error}
          </div>
        )}

        {preview && preview.bounds && (
          <>
            <div
              style={{
                padding: "14px 16px",
                borderTop: "1px solid #e2e8f0",
                background: "#f8fafc",
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 600, color: "#0f172a" }}>
                {(preview.bounds.widthCm / 100).toFixed(2)} × {(preview.bounds.heightCm / 100).toFixed(2)} מ'
              </div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                {preview.groups.length} {preview.groups.length === 1 ? "יציקה" : "יציקות"} ·{" "}
                {preview.wallCount} קירות
              </div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                עובי קירות:{" "}
                <strong>
                  {preview.thicknesses.length === 1
                    ? `${preview.thicknesses[0]} ס"מ`
                    : `${preview.thicknesses.join(", ")} ס"מ`}
                </strong>{" "}
                {preview.measured > 0 && (
                  <span style={{ color: "#16a34a" }}>
                    ({preview.measured} נמדדו מהשרטוט)
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                הגודל לא נכון? שנה את היחידות למטה.
              </div>
            </div>

            <div
              style={{
                padding: "10px 16px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                יחידות:
                <div
                  role="group"
                  style={{
                    display: "inline-flex",
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  {UNITS.map((u) => (
                    <button
                      key={u.value}
                      type="button"
                      onClick={() => setUnit(u.value)}
                      style={{
                        padding: "4px 10px",
                        background: unit === u.value ? "#0f172a" : "#fff",
                        color: unit === u.value ? "#fff" : "#0f172a",
                        border: "none",
                        fontFamily: "inherit",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </label>

              <label
                style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                title="משמש רק לקירות שלא נמצאה להם פאה נגדית בשרטוט"
              >
                עובי ברירת מחדל:
                <input
                  type="number"
                  min={1}
                  value={thickness}
                  onChange={(e) => setThickness(Math.max(1, Number(e.target.value) || 1))}
                  style={{ ...inputStyle, width: 64 }}
                />
                ס"מ
              </label>
            </div>

            <footer
              style={{
                padding: "12px 16px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={handleImport}
                style={{ ...primaryButton, padding: "8px 20px" }}
              >
                ייבא
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontFamily: "inherit",
};

const primaryButton: React.CSSProperties = {
  padding: "6px 12px",
  background: "#0f172a",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const closeButton: React.CSSProperties = {
  background: "transparent",
  border: "none",
  fontSize: 20,
  cursor: "pointer",
  color: "#64748b",
  lineHeight: 1,
  padding: 0,
  width: 24,
  height: 24,
};
