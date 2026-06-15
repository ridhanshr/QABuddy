import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { Plugin } from "vite";
import fs from "node:fs";

function removeCrossorigin(): Plugin {
  return {
    name: "remove-crossorigin",
    transformIndexHtml(html) {
      return html.replaceAll("crossorigin", "");
    },
  };
}

function copyTesseractWorker(): Plugin {
  return {
    name: "copy-tesseract-worker",
    writeBundle() {
      const srcWorker = path.join(__dirname, "node_modules", "tesseract.js", "dist", "worker.min.js");
      const destDir = path.join(__dirname, "out", "main");
      const destWorker = path.join(destDir, "worker.min.js");

      if (fs.existsSync(srcWorker)) {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(srcWorker, destWorker);
        console.log("Copied tesseract worker.min.js to out/main/");
      }
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
    plugins: [copyTesseractWorker()],
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
