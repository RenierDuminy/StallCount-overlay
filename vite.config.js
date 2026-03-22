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
        overlayWfdfCompetitive: fileURLToPath(new URL("./overlay-wfdf-competitive.html", import.meta.url)),
      },
    },
  },
});
