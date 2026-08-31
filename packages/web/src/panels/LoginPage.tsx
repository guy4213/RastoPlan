import { useState, type FormEvent } from "react";
import { login, type Account } from "../auth/api.js";
import { authPageStyles } from "./authStyles.js";

interface LoginPageProps {
  onSignedIn: (account: Account) => void;
  onSwitchToRegister: () => void;
}

export function LoginPage({ onSignedIn, onSwitchToRegister }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onSignedIn(await login(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const s = authPageStyles;
  return (
    <div dir="rtl" style={s.page}>
      <form style={s.card} onSubmit={(e) => void handleSubmit(e)}>
        <h1 style={s.title}>התחברות</h1>
        <p style={s.subtitle}>RastoPlan — תכנון תבניות</p>

        <label style={s.label}>
          אימייל
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={s.input}
          />
        </label>

        <label style={s.label}>
          סיסמה
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={s.input}
          />
        </label>

        {error && (
          <p role="alert" style={s.error}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} style={s.primaryButton}>
          {busy ? "מתחבר…" : "התחבר"}
        </button>

        <button type="button" onClick={onSwitchToRegister} style={s.linkButton}>
          אין לך חשבון? הרשמה
        </button>
      </form>
    </div>
  );
}
