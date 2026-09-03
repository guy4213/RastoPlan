export type StorageMode = "api" | "indexeddb";

interface ClientEnv {
  readonly VITE_STORAGE_PROVIDER?: string;
  readonly VITE_API_BASE_URL?: string;
}

export interface ClientConfig {
  readonly storageMode: StorageMode;
  readonly apiBaseUrl: string;
  readonly configurationError?: string;
}

export const MISSING_API_URL_MESSAGE =
  "חסרה כתובת השרת VITE_API_BASE_URL. במצב פיתוח יש להעתיק את packages/web/.env.example ל-packages/web/.env.local ולהפעיל מחדש את האפליקציה.";

export function resolveClientConfig(env: ClientEnv): ClientConfig {
  const requestedMode = env.VITE_STORAGE_PROVIDER?.trim() || "api";

  if (requestedMode === "indexeddb") {
    return { storageMode: "indexeddb", apiBaseUrl: "" };
  }

  if (requestedMode !== "api") {
    return {
      storageMode: "api",
      apiBaseUrl: "",
      configurationError: `ערך לא חוקי ב-VITE_STORAGE_PROVIDER: ${requestedMode}. הערכים המותרים הם api או indexeddb.`,
    };
  }

  const apiBaseUrl = normalizeBaseUrl(env.VITE_API_BASE_URL ?? "");
  return apiBaseUrl
    ? { storageMode: "api", apiBaseUrl }
    : { storageMode: "api", apiBaseUrl, configurationError: MISSING_API_URL_MESSAGE };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export const clientConfig = resolveClientConfig(import.meta.env);
