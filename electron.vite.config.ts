import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { Plugin } from "vite";

function removeCrossorigin(): Plugin {
  return {
    name: "remove-crossorigin",
    transformIndexHtml(html) {
      return html.replaceAll("crossorigin", "");
    },
  };
}

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
    },
    resolve: {
      alias: {
        "@shared": path.resolve("src/shared"),
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
    },
    resolve: {
      alias: {
        "@shared": path.resolve("src/shared"),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": path.resolve("src/renderer/src"),
        "@shared": path.resolve("src/shared"),
      },
    },
    plugins: [react(), removeCrossorigin()],
  },
});
