import { createContext, useContext } from "react";
import type { Account } from "./api.js";

export interface SessionValue {
  account: Account;
  logout: () => void;
  loggingOut: boolean;
  logoutError: string | null;
}

/**
 * The signed-in account, published by AuthGate so the toolbar can show it.
 *
 * The account chip used to be a fixed-position overlay, which sat on top of the
 * toolbar and covered the חשב button. Handing the details down instead lets the
 * toolbar lay it out with everything else.
 *
 * Null in IndexedDB mode: there is no server, so there is no account.
 */
const SessionContext = createContext<SessionValue | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useSession(): SessionValue | null {
  return useContext(SessionContext);
}
