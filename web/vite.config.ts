import { defineConfig } from "vitest/config";
export default defineConfig({
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
  build: { outDir: "../backend/web-dist", emptyOutDir: true },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}"],
      reporter: ["text", "lcov", "json-summary"],
      thresholds: { statements: 75 },
    },
  },
});
