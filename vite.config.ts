import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// Each build's version: built into the code and written to version.json, so an open game can tell it's out of date.
const BUILD = String(Date.now());
const versionFile = { name: "bellmont-version", generateBundle(this: { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void }) { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ v: BUILD }) }); } };

// A static single-page build; relative asset paths so it can be hosted from any folder (e.g. a claude.ai artifact).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), versionFile],
  define: { __BUILD__: JSON.stringify(BUILD) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { chunkSizeWarningLimit: 4000 },
});
