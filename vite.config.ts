import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  // OpenSheetMusicDisplay alone is ~1.3 MB; splitting it buys nothing for a single-page tool.
  build: { chunkSizeWarningLimit: 2000 },
});
