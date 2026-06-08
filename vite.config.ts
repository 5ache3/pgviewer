import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev-server port and surfaces Rust errors directly,
// so we don't let Vite obscure the terminal.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror the "@/*" -> "src/*" alias declared in tsconfig.json.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // src-tauri is watched by the Rust toolchain, not Vite.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Expose TAURI_* env vars to the client.
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2021",
    sourcemap: true,
  },
});
