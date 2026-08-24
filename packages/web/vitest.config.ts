import { fileURLToPath } from "node:url";

// Deliberately a plain object rather than `defineConfig` from "vitest/config":
// vitest is hoisted into the core package, not this one, so importing it here
// fails to resolve. The shape is the same and vitest accepts it as is.
export default {
  test: {
    // The reducer is plain state-in/state-out and needs no DOM. Components are
    // not covered here; this exists for the project state logic.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Resolve the workspace dependency to source, so a test run can never
      // pick up a `dist` built before the change under test.
      "@rastoplan/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
};
