import type { StorageProvider } from "@rastoplan/core";
import { clientConfig } from "../auth/config.js";
import { IndexedDBProvider } from "./IndexedDBProvider.js";
import { ApiProvider } from "./ApiProvider.js";

export type { StorageProvider, ProjectMeta } from "@rastoplan/core";

function createStorageProvider(): StorageProvider {
  switch (clientConfig.storageMode) {
    case "api":
      return new ApiProvider(clientConfig.apiBaseUrl);
    case "indexeddb":
      return new IndexedDBProvider();
  }
}

export const storageProvider: StorageProvider = createStorageProvider();
