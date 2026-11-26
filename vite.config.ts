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
  build: {
    chunkSizeWarningLimit: 4000,
    // The libraries in files of their own: they rarely change, so a new version of the game doesn't make a phone
    // download them again (they stay cached for a year). The 3D ones only come with the game.
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            // (Vite's own little helpers too: the start page uses them, so they mustn't end up in the 3D file.)
            { name: "vite-helpers", test: /preload-helper|commonjsHelpers|rolldown[\\/]runtime/, priority: 40 },
            { name: "vendor-react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store|@babel[\\/]runtime)[\\/]/, priority: 30 },
            { name: "vendor-3d", test: /[\\/]node_modules[\\/](three|three-stdlib|@react-three|react-reconciler|its-fine|suspend-react|zustand|postprocessing|maath|troika[^\\/]*|meshline|camera-controls|@dimforge|react-use-measure)[\\/]/, priority: 20 },
            { name: "vendor-firebase", test: /[\\/]node_modules[\\/](@firebase|firebase)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
