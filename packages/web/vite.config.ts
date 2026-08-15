import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  worker: {
    // The CAD worker dynamically imports the wasm reader, which means code
    // splitting, which Vite's default IIFE worker format cannot express.
    format: "es",
  },
  optimizeDeps: {
    // libredwg locates its 10MB .wasm with `new URL(..., import.meta.url)`.
    // Vite rewrites that correctly only when it sees the real module; through
    // the esbuild dep pre-bundle the URL resolves into .vite/deps, where no
    // wasm exists, and the import 404s in dev but works in build.
    exclude: ["@mlightcad/libredwg-web"],
  },
});
