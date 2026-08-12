import { defineConfig } from "vite";

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
  },

  worker: { format: "es" },
});
