// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/build/**", "**/node_modules/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // spikes/ are throwaway scripts run by hand under Node, not shipped code.
    // Without these globals every one of them is a wall of no-undef errors,
    // which is what kept `pnpm lint` red.
    files: ["spikes/**"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        require: "readonly",
        module: "writable",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        // the Playwright spike evaluates callbacks inside the page
        window: "readonly",
        document: "readonly",
        performance: "readonly",
        indexedDB: "readonly",
        PerformanceObserver: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      // a .cjs spike is CommonJS by extension; require() is the correct form there
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
