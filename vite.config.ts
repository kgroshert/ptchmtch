import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// `npm run dev:lan` serves on all interfaces over HTTPS (self-signed), so a phone on the same
// network can open it: browsers only allow the microphone on HTTPS or localhost.
const lan = !!process.env.LAN;

export default defineConfig({
  base: "./",
  plugins: lan ? [basicSsl()] : [],
  server: lan ? { host: true } : {},
  // OpenSheetMusicDisplay alone is ~1.3 MB; splitting it buys nothing for a single-page tool.
  build: { chunkSizeWarningLimit: 2000 },
});
