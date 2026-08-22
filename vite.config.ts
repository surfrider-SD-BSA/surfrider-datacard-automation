import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // Relative base so the built site works from a GitHub Pages project path
  // (username.github.io/repo/) without knowing the repo name at build time.
  base: "./",

  // Serve assets/ directly. The reference card images, the cell maps and the
  // chapter's Excel template are all needed at runtime, and this keeps one copy
  // of each rather than duplicating them into public/.
  publicDir: "assets",

  build: {
    outDir: "dist",
    // The reference PNGs are ~1.8MB each and must stay as files.
    assetsInlineLimit: 0,

    // Two entry points onto one set of algorithms.
    //
    // `index.html` is the browser tool. `engine.html` is the same pipeline
    // with the interface taken off, for the iOS app to drive from SwiftUI --
    // see src/engine.ts. They share every module under src/lib/, which is the
    // point: there is one implementation of the reading and it is measured
    // once.
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        engine: resolve(__dirname, "engine.html"),
      },
    },
  },

  worker: { format: "es" },
});
