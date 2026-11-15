import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;
const integration = resolve(here, "../custom_components/diorama");
const manifest = JSON.parse(readFileSync(resolve(integration, "manifest.json"), "utf8"));

// Two entry files with fixed names, which the integration points Home
// Assistant at. Everything heavy goes into hashed chunks next to them, loaded
// with import() only when a card or the panel is actually on screen.
export default defineConfig({
  // Relative, so chunks are found next to the entry files wherever the
  // integration serves them from.
  base: "./",
  define: {
    __DIORAMA_VERSION__: JSON.stringify(manifest.version),
  },
  build: {
    outDir: resolve(integration, "frontend/dist"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: {
        "diorama-card": resolve(here, "src/entries/card.ts"),
        "diorama-panel": resolve(here, "src/entries/panel.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
