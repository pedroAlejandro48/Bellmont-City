// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { stripGamePreviewTags } from "./src/lib/game-preview-tags";

export default defineConfig({
  vite: {
    plugins: [{
      name: "bellmont-r3f-preview-source-guard",
      enforce: "pre",
      // Runs after the bundled devtools source injector, before JSX compilation.
      transform(code, id) {
        const cleaned = stripGamePreviewTags(code, id);
        return cleaned === code ? null : { code: cleaned, map: null };
      },
    }],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
