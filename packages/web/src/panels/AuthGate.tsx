import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AUTH_ENABLED, me, type Account } from "../auth/api.js";
import { LoginPage } from "./LoginPage.js";
import { RegisterPage } from "./RegisterPage.js";
import { authPageStyles } from "./authStyles.js";

type Phase =
  | { kind: "checking" }
  | { kind: "signed-out"; screen: "login" | "register" }
  | { kind: "signed-in"; account: Account }
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
  const [phase, setPhase] = useState<Phase>(
    AUTH_ENABLED ? { kind: "checking" } : { kind: "signed-in", account: { id: "local", email: "" } }
  );

  const check = useCallback(() => {
    if (!AUTH_ENABLED) return;
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

  if (phase.kind === "signed-in") return <>{children}</>;

  const s = authPageStyles;

  if (phase.kind === "checking") {
    return (
      <div dir="rtl" style={s.page}>
        <p style={s.subtitle}>טוען…</p>
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
