/**
 * Account endpoints, kept out of the storage providers on purpose: signing in
 * is not part of the `StorageProvider` contract, and IndexedDB mode has no
 * server to sign in to.
 */
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

/** Auth only exists when the app talks to the API; local storage mode has no accounts. */
export const AUTH_ENABLED = (import.meta.env.VITE_STORAGE_PROVIDER ?? "indexeddb") === "api";

export interface Account {
  id: string;
  email: string;
}

export class AuthError extends Error {}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body !== undefined) headers.set("Content-Type", "application/json");

  return fetch(`${baseUrl}${path}`, { ...init, headers, credentials: "include" });
}

async function readError(response: Response): Promise<string> {
  const body = await response.text();
  if (!body.trim()) return `שגיאת שרת (${response.status})`;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // A proxy or gateway can answer with plain text; show it as-is.
  }
  return body.trim();
}

async function submitCredentials(path: string, email: string, password: string): Promise<Account> {
  const response = await request(path, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new AuthError(await readError(response));
  return (await response.json()) as Account;
}

export function register(email: string, password: string): Promise<Account> {
  return submitCredentials("/api/auth/register", email, password);
}

export function login(email: string, password: string): Promise<Account> {
  return submitCredentials("/api/auth/login", email, password);
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST" });
}

/** Resolves the signed-in account, or undefined when there is no valid session. */
export async function me(): Promise<Account | undefined> {
  const response = await request("/api/auth/me");
  if (response.status === 401) return undefined;
  if (!response.ok) throw new AuthError(await readError(response));
  return (await response.json()) as Account;
}
