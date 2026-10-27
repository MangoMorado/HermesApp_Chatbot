import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "**/node_modules/**",
        "**/.next/**",
        "**/coverage/**",
        // Clientes generados por orval (no se editan a mano).
        "src/api/**",
        "src/sim/**",
        "src/platform/**",
        "src/widget/api/**",
      ],
    },
  },
});
