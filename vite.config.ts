import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// Inject a unique build ID into sw.js so each deploy triggers a SW update
function swVersionPlugin() {
  return {
    name: "sw-version",
    writeBundle() {
      const swPath = resolve("dist", "sw.js");
      try {
        const content = readFileSync(swPath, "utf-8");
        const buildId = Date.now().toString(36);
        writeFileSync(swPath, content.replace(/__BUILD_ID__/g, buildId));
      } catch {
        // sw.js not in dist yet — skip
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), swVersionPlugin()],
  build: {
    target: "esnext",
    outDir: "dist",
  },
  server: {
    port: 5173,
  },
});
