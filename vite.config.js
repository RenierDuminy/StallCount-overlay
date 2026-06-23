import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        overlayDebug: fileURLToPath(new URL("./overlay-debug.html", import.meta.url)),
        overlayWfdfCompetitive: fileURLToPath(new URL("./overlays/wfdf-competitive.html", import.meta.url)),
        overlayCornerBox: fileURLToPath(new URL("./overlays/corner-box.html", import.meta.url)),
        overlayCornerBoxBottomLeft: fileURLToPath(new URL("./overlays/corner-box-bottom-left.html", import.meta.url)),
        overlayCompactBar: fileURLToPath(new URL("./overlays/compact-bar.html", import.meta.url)),
        overlayWideBar: fileURLToPath(new URL("./overlays/wide-bar.html", import.meta.url)),
        overlayTopRightList: fileURLToPath(new URL("./overlays/top-right-list.html", import.meta.url)),
        overlayBadgeCentre: fileURLToPath(new URL("./overlays/badge-centre.html", import.meta.url)),
      },
    },
  },
});
