// Standalone guest build of the game (no auth/SSR): `npm run build:preview` → dist-preview/
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "preview",
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "../dist-preview", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
