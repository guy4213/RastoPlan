import { useEffect, useRef, useState } from "react";
import { useSession } from "../auth/session.js";

/**
 * The signed-in account as a round avatar that opens a small menu.
 *
 * Renders nothing in IndexedDB mode, where there is no server and no account.
 */
export function AccountMenu() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, the way every menu is expected to
  // behave. Without this the panel stays open over the canvas and swallows
  // the next click the user meant for a wall.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!session) return null;

  const email = session.account.email;
  const initial = (email.trim()[0] ?? "?").toUpperCase();

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`חשבון: ${email}`}
        title={email}
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          border: "1px solid #cbd5e1",
          background: "#0f172a",
          color: "#fff",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          lineHeight: 1,
        }}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          dir="rtl"
          style={{
            position: "absolute",
            insetBlockStart: "calc(100% + 6px)",
            insetInlineEnd: 0,
            minWidth: 220,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 12px 28px rgba(15, 23, 42, 0.16)",
            zIndex: 1000,
            overflow: "hidden",
            fontFamily: "inherit",
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>מחובר כ־</div>
            <div style={{ fontSize: 13, wordBreak: "break-all" }}>{email}</div>
          </div>

          {session.logoutError && (
            <div role="alert" style={{ padding: "8px 12px", fontSize: 12, color: "#b91c1c" }}>
              {session.logoutError}
            </div>
          )}

          <button
            type="button"
            role="menuitem"
            disabled={session.loggingOut}
            onClick={session.logout}
            style={{
              width: "100%",
              textAlign: "start",
              padding: "10px 12px",
              border: "none",
              background: "none",
              color: "#b91c1c",
              fontFamily: "inherit",
              fontSize: 13,
              cursor: session.loggingOut ? "wait" : "pointer",
            }}
          >
            {session.loggingOut ? "מתנתק…" : "התנתקות"}
          </button>
        </div>
      )}
    </div>
  );
}
