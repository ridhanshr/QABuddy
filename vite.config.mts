import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const host = process.env.TAURI_DEV_HOST;
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": path.resolve(rootDir, "src/renderer/src"),
      "@shared": path.resolve(rootDir, "src/shared"),
    },
  },
  build: {
    outDir: path.resolve(rootDir, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
          if (id.includes("xlsx")) return "vendor-xlsx";
          if (id.includes("marked")) return "vendor-markdown";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
