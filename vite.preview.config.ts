// Static build of the game (no SSR/server functions): `npm run build:preview` → dist-preview/
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "preview",
  base: "./",
  envDir: "..",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "../dist-preview", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
