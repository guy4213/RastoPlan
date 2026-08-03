import { useEffect, useState } from "react";
import type { ProjectMeta } from "@rastoplan/core";
import { useProjectManager } from "../state/ProjectContext.js";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Project switcher: lists everything in local storage, lets the user pick
 * a project to open, or create / duplicate / rename / delete. The current
 * project stays visible with a distinct badge and cannot be deleted from
 * the modal without confirming — the browser confirm is intentional.
 */
export function ProjectsModal({ open, onClose }: Props) {
  const manager = useProjectManager();
  const [items, setItems] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void manager
      .list()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, manager]);

  async function refresh() {
    const rows = await manager.list();
    setItems(rows);
  }

  async function handleCreate() {
    const name = newName.trim() || "פרויקט חדש";
    setBusyId("__new__");
    try {
      await manager.create(name);
      setNewName("");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleOpen(id: string) {
    if (id === manager.currentId) {
      onClose();
      return;
    }
    setBusyId(id);
    try {
      await manager.open(id);
      onClose();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDuplicate(id: string, name: string) {
    setBusyId(id);
    try {
      await manager.duplicate(id, `${name} (עותק)`);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`למחוק את "${name}"? הפעולה בלתי הפיכה.`)) return;
    setBusyId(id);
    try {
      await manager.remove(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
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
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxHeight: "80vh",
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
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>פרויקטים</h2>
          <button type="button" onClick={onClose} style={closeButton} aria-label="סגור">
            ×
          </button>
        </header>

        <div style={{ padding: 12, borderBottom: "1px solid #e2e8f0", display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="שם פרויקט חדש"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={busyId === "__new__"}
            style={primaryButton}
          >
            צור חדש
          </button>
        </div>

        <div style={{ overflow: "auto", flex: 1 }}>
          {loading ? (
            <p style={emptyState}>טוען...</p>
          ) : items.length === 0 ? (
            <p style={emptyState}>אין עדיין פרויקטים שמורים.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((meta) => {
                const isCurrent = meta.id === manager.currentId;
                const busy = busyId === meta.id;
                return (
                  <li
                    key={meta.id}
                    style={{
                      padding: "10px 16px",
                      borderBottom: "1px solid #f1f5f9",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: isCurrent ? "#f8fafc" : "transparent",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <strong style={{ fontSize: 13 }}>{meta.name}</strong>
                        {isCurrent && <span style={currentBadge}>נוכחי</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                        {meta.poursCount} יציקות · עודכן {formatDate(meta.updatedAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpen(meta.id)}
                      disabled={busy}
                      style={isCurrent ? secondaryButton : primaryButton}
                    >
                      {isCurrent ? "פתוח" : "פתח"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicate(meta.id, meta.name)}
                      disabled={busy}
                      style={secondaryButton}
                    >
                      שכפל
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(meta.id, meta.name)}
                      disabled={busy || (isCurrent && items.length === 1)}
                      style={dangerButton}
                      title={
                        isCurrent && items.length === 1
                          ? "אי אפשר למחוק את הפרויקט היחיד"
                          : undefined
                      }
                    >
                      מחק
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

const inputStyle: React.CSSProperties = {
  flex: 1,
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

const secondaryButton: React.CSSProperties = {
  padding: "6px 12px",
  background: "#f1f5f9",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 12,
  cursor: "pointer",
};

const dangerButton: React.CSSProperties = {
  padding: "6px 12px",
  background: "#fff",
  color: "#b91c1c",
  border: "1px solid #fca5a5",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 12,
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

const currentBadge: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: "1px 6px",
  borderRadius: 999,
  background: "#dcfce7",
  color: "#166534",
};

const emptyState: React.CSSProperties = {
  padding: 16,
  fontSize: 13,
  color: "#94a3b8",
  textAlign: "center",
};
