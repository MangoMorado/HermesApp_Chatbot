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
        // UI presentacional: fuera del denominador (cobertura de lógica).
        "src/app/**",
        "src/components/**/*.tsx",
        "src/widget/**/*.tsx",
        // Hooks React: requieren RTL (no instalado).
        "src/lib/use-*.ts",
        "src/widget/use-*.ts",
        "src/components/**/use-*.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
      },
    },
  },
});
