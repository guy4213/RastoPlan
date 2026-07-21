import type { StorageProvider } from "@rastoplan/core";
import { IndexedDBProvider } from "./IndexedDBProvider.js";
import { ApiProvider } from "./ApiProvider.js";

export type { StorageProvider, ProjectMeta } from "@rastoplan/core";

// Provider selection is a one-line config change (spec 12.1), driven by env.
function createStorageProvider(): StorageProvider {
  const kind = import.meta.env.VITE_STORAGE_PROVIDER ?? "indexeddb";

  switch (kind) {
    case "api":
      return new ApiProvider(import.meta.env.VITE_API_BASE_URL ?? "");
    case "indexeddb":
      return new IndexedDBProvider();
    default:
      throw new Error(`Unknown VITE_STORAGE_PROVIDER: ${kind}`);
  }
}

export const storageProvider: StorageProvider = createStorageProvider();
