import { describe, expect, it } from "vitest";
import { MISSING_API_URL_MESSAGE, resolveClientConfig } from "./config.js";

describe("resolveClientConfig", () => {
  it("defaults to account-backed API mode", () => {
    expect(resolveClientConfig({})).toEqual({
      storageMode: "api",
      apiBaseUrl: "",
      configurationError: MISSING_API_URL_MESSAGE,
    });
  });

  it("uses API mode with a normalized configured server URL", () => {
    expect(
      resolveClientConfig({
        VITE_STORAGE_PROVIDER: "api",
        VITE_API_BASE_URL: "  http://localhost:3000///  ",
      })
    ).toEqual({ storageMode: "api", apiBaseUrl: "http://localhost:3000" });
  });

  it("only enables offline storage when indexeddb is selected explicitly", () => {
    expect(
      resolveClientConfig({
        VITE_STORAGE_PROVIDER: "indexeddb",
        VITE_API_BASE_URL: "http://localhost:3000",
      })
    ).toEqual({ storageMode: "indexeddb", apiBaseUrl: "" });
  });

  it("reports an invalid storage mode instead of silently falling back offline", () => {
    const config = resolveClientConfig({ VITE_STORAGE_PROVIDER: "local" });

    expect(config.storageMode).toBe("api");
    expect(config.configurationError).toContain("VITE_STORAGE_PROVIDER");
    expect(config.configurationError).toContain("local");
  });
});
