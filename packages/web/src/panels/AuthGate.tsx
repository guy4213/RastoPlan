import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AUTH_CONFIGURATION_ERROR,
  AUTH_ENABLED,
  logout,
  me,
  type Account,
} from "../auth/api.js";
import { LoginPage } from "./LoginPage.js";
import { RegisterPage } from "./RegisterPage.js";
import { authPageStyles } from "./authStyles.js";

type Phase =
  | { kind: "checking" }
  | { kind: "signed-out"; screen: "login" | "register" }
  | { kind: "signed-in"; account: Account }
  | { kind: "configuration-error"; message: string }
  | { kind: "unreachable"; message: string };

/**
 * Gates the whole app on a session when the API provider is active.
 *
 * It has to sit outside ProjectProvider: that provider lists and loads
 * projects the moment it mounts, and every one of those calls is rejected
 * without a session.
 *
 * In IndexedDB mode there is no server and no account, so the gate steps
 * aside entirely rather than blocking offline use behind a login it cannot
 * perform.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [phase, setPhase] = useState<Phase>(
    AUTH_CONFIGURATION_ERROR
      ? { kind: "configuration-error", message: AUTH_CONFIGURATION_ERROR }
      : AUTH_ENABLED
        ? { kind: "checking" }
        : { kind: "signed-in", account: { id: "local", email: "" } }
  );

  const check = useCallback(() => {
    if (!AUTH_ENABLED || AUTH_CONFIGURATION_ERROR) return;
    setPhase({ kind: "checking" });
    void me()
      .then((account) =>
        setPhase(account ? { kind: "signed-in", account } : { kind: "signed-out", screen: "login" })
      )
      .catch((err: unknown) =>
        setPhase({ kind: "unreachable", message: err instanceof Error ? err.message : String(err) })
      );
  }, []);

  useEffect(check, [check]);

  if (phase.kind === "signed-in") {
    if (!AUTH_ENABLED) return <>{children}</>;

    const handleLogout = async () => {
      setLogoutError(null);
      setLoggingOut(true);
      try {
        await logout();
        setPhase({ kind: "signed-out", screen: "login" });
      } catch (err) {
        setLogoutError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoggingOut(false);
      }
    };

    return (
      <>
        <div
          dir="rtl"
          style={{
            position: "fixed",
            insetBlockStart: 8,
            insetInlineEnd: 12,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 8px",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            background: "#fff",
            boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
            fontFamily: "system-ui, -apple-system, Segoe UI, Arial, sans-serif",
            fontSize: 12,
          }}
        >
          <span>{phase.account.email}</span>
          <button
            type="button"
            disabled={loggingOut}
            onClick={() => void handleLogout()}
            style={{
              border: "none",
              background: "none",
              color: "#1d4ed8",
              cursor: loggingOut ? "wait" : "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              padding: 0,
            }}
          >
            {loggingOut ? "מתנתק…" : "התנתקות"}
          </button>
          {logoutError && (
            <span role="alert" style={{ color: "#b91c1c" }}>
              {logoutError}
            </span>
          )}
        </div>
        {children}
      </>
    );
  }

  const s = authPageStyles;

  if (phase.kind === "checking") {
    return (
      <div dir="rtl" style={s.page}>
        <p style={s.subtitle}>טוען…</p>
      </div>
    );
  }

  if (phase.kind === "configuration-error") {
    return (
      <div dir="rtl" style={s.page}>
        <div style={s.card}>
          <h1 style={s.title}>נדרשת הגדרת שרת</h1>
          <p role="alert" style={s.error}>
            {phase.message}
          </p>
        </div>
      </div>
    );
  }

  // A server that cannot be reached is a different problem from a missing
  // session, and telling the two apart saves the user from retyping a password
  // that was never the issue.
  if (phase.kind === "unreachable") {
    return (
      <div dir="rtl" style={s.page}>
        <div style={s.card}>
          <h1 style={s.title}>השרת אינו זמין</h1>
          <p role="alert" style={s.error}>
            {phase.message}
          </p>
          <button type="button" onClick={check} style={s.primaryButton}>
            נסה שוב
          </button>
        </div>
      </div>
    );
  }

  const signedIn = (account: Account) => setPhase({ kind: "signed-in", account });

  return phase.screen === "login" ? (
    <LoginPage
      onSignedIn={signedIn}
      onSwitchToRegister={() => setPhase({ kind: "signed-out", screen: "register" })}
    />
  ) : (
    <RegisterPage
      onSignedIn={signedIn}
      onSwitchToLogin={() => setPhase({ kind: "signed-out", screen: "login" })}
    />
  );
}
