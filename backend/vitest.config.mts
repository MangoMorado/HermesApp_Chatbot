import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
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
        // Adaptadores HTTP/DI/Prisma: los cubre `test:db`, no el proyecto unit.
        "src/app/**",
        "src/composition/**",
        "src/composition-root.ts",
        "**/infrastructure/prisma*",
        "src/modules/shared/infrastructure/prisma-client.ts",
        "src/http/openapi*.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
      },
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/db/**"],
          setupFiles: ["tests/setup-env.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          setupFiles: ["tests/setup-env.ts", "tests/db/setup-env-db.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          // Una sola base compartida: los archivos corren en serie.
          fileParallelism: false,
          maxWorkers: 1,
          pool: "threads",
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
