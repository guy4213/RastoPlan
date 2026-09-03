import { useState, type FormEvent } from "react";
import { register, type Account } from "../auth/api.js";
import { authPageStyles } from "./authStyles.js";

/** Mirrors MIN_PASSWORD_LENGTH on the server so the field fails fast, locally. */
const MIN_PASSWORD_LENGTH = 8;

interface RegisterPageProps {
  onSignedIn: (account: Account) => void;
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onSignedIn, onSwitchToLogin }: RegisterPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onSignedIn(await register({ email, password }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const s = authPageStyles;
  return (
    <div dir="rtl" style={s.page}>
      <form style={s.card} onSubmit={(e) => void handleSubmit(e)}>
        <h1 style={s.title}>הרשמה</h1>
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
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={s.input}
          />
        </label>

        <label style={s.label}>
          אימות סיסמה
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={s.input}
          />
        </label>

        <p style={s.hint}>לפחות {MIN_PASSWORD_LENGTH} תווים.</p>

        {error && (
          <p role="alert" style={s.error}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} style={s.primaryButton}>
          {busy ? "נרשם…" : "הרשמה"}
        </button>

        <button type="button" onClick={onSwitchToLogin} style={s.linkButton}>
          כבר יש לך חשבון? התחברות
        </button>
      </form>
    </div>
  );
}
