import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastKind = "info" | "error" | "success";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (message: string, kind?: ToastKind) => void;
}

const Ctx = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  info: 3500,
  success: 3500,
  error: 6000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS[kind]);
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 16,
          insetInlineStart: 16,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 360,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            onClick={() => dismiss(t.id)}
            style={{
              pointerEvents: "auto",
              padding: "10px 14px",
              borderRadius: 6,
              fontSize: 13,
              fontFamily: "inherit",
              color: t.kind === "error" ? "#7f1d1d" : t.kind === "success" ? "#14532d" : "#0f172a",
              background:
                t.kind === "error" ? "#fee2e2" : t.kind === "success" ? "#dcfce7" : "#f1f5f9",
              border: `1px solid ${
                t.kind === "error" ? "#fca5a5" : t.kind === "success" ? "#86efac" : "#cbd5e1"
              }`,
              boxShadow: "0 6px 16px rgba(15, 23, 42, 0.12)",
              cursor: "pointer",
              direction: "rtl",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useToast must be used inside <ToastProvider>");
  return value;
}
