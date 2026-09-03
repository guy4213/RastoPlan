import { clientConfig, MISSING_API_URL_MESSAGE } from "./config.js";

/** Auth only exists when the app talks to the API; local storage mode has no accounts. */
export const AUTH_ENABLED = clientConfig.storageMode === "api";
export const AUTH_CONFIGURATION_ERROR = clientConfig.configurationError;

export interface Account {
  id: string;
  email: string;
}

export class AuthError extends Error {}

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

export interface AuthApi {
  register(credentials: RegisterCredentials): Promise<Account>;
  login(email: string, password: string): Promise<Account>;
  logout(): Promise<void>;
  me(): Promise<Account | undefined>;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  registrationCode?: string;
}

export function createAuthApi(baseUrl: string, fetchImplementation: typeof fetch = fetch): AuthApi {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");

  async function request(path: string, init?: RequestInit): Promise<Response> {
    if (!normalizedBaseUrl) throw new AuthError(MISSING_API_URL_MESSAGE);

    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    if (init?.body !== undefined) headers.set("Content-Type", "application/json");

    return fetchImplementation(`${normalizedBaseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  }

  async function readAccount(response: Response): Promise<Account> {
    if (!response.ok) throw new AuthError(await readError(response));

    const value = (await response.json()) as unknown;
    if (!isAccount(value)) {
      throw new AuthError("השרת החזיר תשובת משתמש לא תקינה");
    }
    return value;
  }

  async function submitCredentials(path: string, email: string, password: string): Promise<Account> {
    return readAccount(
      await request(path, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
    );
  }

  return {
    register: async (credentials) => {
      const response = await request("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
      return readAccount(response);
    },
    login: (email, password) => submitCredentials("/api/auth/login", email, password),
    async logout() {
      const response = await request("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new AuthError(await readError(response));
    },
    async me() {
      const response = await request("/api/auth/me");
      if (response.status === 401) return undefined;
      return readAccount(response);
    },
  };
}

const authApi = createAuthApi(clientConfig.apiBaseUrl);

export const register = authApi.register;
export const login = authApi.login;
export const logout = authApi.logout;
export const me = authApi.me;

function isAccount(value: unknown): value is Account {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "email" in value &&
    typeof value.email === "string"
  );
}
