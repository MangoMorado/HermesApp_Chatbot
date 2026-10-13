import { defineConfig } from "orval";

const fetchOverride = { includeHttpResponseReturnType: false };

export default defineConfig({
  chatbot: {
    // Las operaciones del widget viven solo en su propio cliente (destino `widget`).
    input: {
      target: "../backend/openapi.json",
      filters: { mode: "exclude", tags: ["widget"] },
    },
    output: {
      target: "./src/api/endpoints.ts",
      schemas: "./src/api/models",
      client: "react-query",
      clean: true,
      mode: "tags-split",
      baseUrl: "/api/v1",
      override: {
        mutator: { path: "./src/lib/api-fetcher.ts", name: "apiFetcher" },
        fetch: fetchOverride,
      },
    },
  },
  simulator: {
    input: "../backend/openapi-sim.json",
    output: {
      target: "./src/sim/endpoints.ts",
      schemas: "./src/sim/models",
      client: "react-query",
      clean: true,
      mode: "tags-split",
      baseUrl: "/api/sim/v1",
      override: {
        mutator: { path: "./src/lib/api-fetcher.ts", name: "apiFetcher" },
        fetch: fetchOverride,
      },
    },
  },
  // Cliente del widget: sin react-query (va en el bundle del script) y con su propio mutator.
  widget: {
    input: {
      target: "../backend/openapi.json",
      filters: { mode: "include", tags: ["widget"] },
    },
    output: {
      target: "./src/widget/api/endpoints.ts",
      schemas: "./src/widget/api/models",
      client: "fetch",
      clean: true,
      mode: "single",
      baseUrl: "/api/v1",
      override: {
        mutator: { path: "./src/widget/fetcher.ts", name: "widgetFetcher" },
        fetch: fetchOverride,
      },
    },
  },
});
