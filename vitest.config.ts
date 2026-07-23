import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@renderer": path.resolve(__dirname, "src/renderer/src"),
      "form-data": path.resolve(__dirname, "src/test-stubs/form-data.ts"),
      "axios": path.resolve(__dirname, "src/test-stubs/axios.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
