import { useEffect, useRef } from "react";
import type { PrintPageSize } from "@rastoplan/core";

interface Props {
  open: boolean;
  onClose: () => void;
  onChoose: (page: PrintPageSize) => void;
}

const PAGE_OPTIONS: { value: PrintPageSize; label: string; hint: string }[] = [
  { value: "A3", label: "A3", hint: "420×297 מ\"מ" },
  { value: "A1", label: "A1", hint: "841×594 מ\"מ" },
  { value: "A0", label: "A0", hint: "1189×841 מ\"מ" },
];

/**
 * A minimal page-size picker for the PDF export flow. Deliberately not a
 * focus trap: Escape closes it and focus returns to whatever opened it, but
 * Tab is left free the whole time it's open, and nothing re-grabs focus once
 * it's closed — the toolbar button is where focus lands next, by the normal
 * browser default rather than by this component reaching for it.
 */
export function PrintPlanDialog({ open, onClose, onChoose }: Props) {
  const openerRef = useRef<Element | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    dialogRef.current?.focus();

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

  if (!open) return null;

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.35)", zIndex: 20 }}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="ייצוא PDF"
        tabIndex={-1}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 21,
          background: "#fff",
          borderRadius: 8,
          padding: 20,
          minWidth: 280,
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          direction: "rtl",
          fontFamily: "inherit",
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 15, color: "#0f172a" }}>ייצוא PDF — בחר גודל גיליון</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {PAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChoose(opt.value)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: "10px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                background: "#f8fafc",
                color: "#0f172a",
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <span>{opt.label}</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: "#64748b" }}>{opt.hint}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "none",
            borderRadius: 6,
            background: "#f1f5f9",
            color: "#334155",
            fontFamily: "inherit",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ביטול
        </button>
      </div>
    </>
  );
}
