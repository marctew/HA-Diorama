import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;
const integration = resolve(here, "../custom_components/diorama");
const manifest = JSON.parse(readFileSync(resolve(integration, "manifest.json"), "utf8"));

// The Draco decoder, for the compressed models people bring. three.js
// fetches it by name from a folder at run time, so it is copied as it is
// beside the entry files rather than bundled.
const DRACO = resolve(here, "node_modules/three/examples/jsm/libs/draco/gltf");
const copyDraco = {
  name: "diorama-copy-draco",
  closeBundle() {
    const target = resolve(integration, "frontend/dist/draco");
    mkdirSync(target, { recursive: true });
    for (const file of ["draco_wasm_wrapper.js", "draco_decoder.wasm", "draco_decoder.js"]) {
      copyFileSync(resolve(DRACO, file), resolve(target, file));
    }
  },
};

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
  plugins: [copyDraco],
  build: {
    outDir: resolve(integration, "frontend/dist"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    // three.js is one big chunk, fetched only when a 3D view is shown.
    chunkSizeWarningLimit: 700,
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
