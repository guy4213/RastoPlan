import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PanelCatalog } from "@rastoplan/core";
import { inventoryLabels, inventoryToFormValues, formValuesToInventory } from "./inventoryFormValues.js";

interface Props {
  open: boolean;
  catalog: PanelCatalog;
  inventory: Record<string, number> | undefined;
  onSave: (inventory: Record<string, number>) => void;
  onClose: () => void;
}

/**
 * Manual alternative to the Excel inventory import: one numeric field per
 * catalog item that can carry inventory (every panel in `catalog` by its
 * bomLabel, plus every accessory item the customer's sheets carry a `מלאי`
 * column for — see `inventoryLabels`), prefilled from `Project.inventory`.
 * Saving builds the exact same `Record<bomLabel, number>` shape the Excel
 * importer produces and hands it to the caller, which dispatches the same
 * `set-inventory` action either way — one reducer case, one downstream
 * BOM/quantities pipeline, two entry points.
 *
 * Focus handling follows the same convention as PrintPlanDialog: capture
 * whatever had focus before opening and restore it on close, so the canvas
 * never loses or has its focus stolen outside the dialog's own lifetime.
 * Unlike that dialog, this one opens with focus already on the first field
 * (there's typing to do immediately), and Enter in any field saves — the
 * form action a modal Enter is expected to trigger.
 */
export function InventoryForm({ open, catalog, inventory, onSave, onClose }: Props) {
  const labels = useMemo(() => inventoryLabels(catalog), [catalog]);
  const [values, setValues] = useState<Record<string, string>>({});
  const openerRef = useRef<Element | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    firstFieldRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open, onClose]);

  // Re-seed the draft from the current inventory each time the dialog opens,
  // so it never shows a stale prefill left over from a previous open.
  useEffect(() => {
    if (open) setValues(inventoryToFormValues(labels, inventory));
  }, [open, labels, inventory]);

  if (!open) return null;

  function setValue(label: string, raw: string) {
    setValues((prev) => ({ ...prev, [label]: raw }));
  }

  function save() {
    onSave(formValuesToInventory(values));
    onClose();
  }

  function handleFieldKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  }

  return (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="הזנת מלאי ידנית"
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>הזנת מלאי ידנית</h2>
          <button type="button" onClick={onClose} style={closeButtonStyle} aria-label="סגור">
            ×
          </button>
        </header>
        <p style={hintStyle}>כמות זמינה לכל פריט. שדה ריק או שלילי נחשב כ-0, בדיוק כמו ייבוא מאקסל.</p>
        <div style={listStyle}>
          {labels.map((label, i) => (
            <label key={label} style={rowStyle}>
              <span style={labelTextStyle} title={label}>
                {label}
              </span>
              <input
                ref={i === 0 ? firstFieldRef : undefined}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={values[label] ?? "0"}
                onChange={(e) => setValue(label, e.target.value)}
                onKeyDown={handleFieldKeyDown}
                style={fieldInputStyle}
              />
            </label>
          ))}
        </div>
        <footer style={footerStyle}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            ביטול
          </button>
          <button type="button" onClick={save} style={primaryButtonStyle}>
            שמור
          </button>
        </footer>
      </div>
    </>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.35)",
  zIndex: 900,
};

const dialogStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  zIndex: 901,
  width: 420,
  maxHeight: "80vh",
  background: "#fff",
  borderRadius: 8,
  boxShadow: "0 20px 40px rgba(15, 23, 42, 0.2)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  direction: "rtl",
  fontFamily: "inherit",
};

const headerStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #e2e8f0",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  padding: "8px 16px",
  fontSize: 11,
  color: "#64748b",
  borderBottom: "1px solid #e2e8f0",
};

const listStyle: React.CSSProperties = {
  overflowY: "auto",
  flex: 1,
  padding: "4px 16px",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "6px 0",
  borderBottom: "1px solid #f1f5f9",
};

const labelTextStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  color: "#334155",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const fieldInputStyle: React.CSSProperties = {
  width: 70,
  flexShrink: 0,
  padding: "4px 6px",
  fontSize: 12,
  textAlign: "center",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontFamily: "inherit",
};

const footerStyle: React.CSSProperties = {
  padding: 12,
  borderTop: "1px solid #e2e8f0",
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "#0f172a",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "#f1f5f9",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 12,
  cursor: "pointer",
};

const closeButtonStyle: React.CSSProperties = {
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
