import { defineConfig } from "orval";

export default defineConfig({
  chatbot: {
    input: "../backend/openapi.json",
    output: {
      target: "./src/api/endpoints.ts",
      schemas: "./src/api/models",
      client: "react-query",
      clean: true,
      mode: "tags-split",
      baseUrl: "/api/v1",
      override: {
        mutator: {
          path: "./src/lib/api-fetcher.ts",
          name: "apiFetcher",
        },
        fetch: {
          includeHttpResponseReturnType: false,
        },
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
        mutator: {
          path: "./src/lib/api-fetcher.ts",
          name: "apiFetcher",
        },
        fetch: {
          includeHttpResponseReturnType: false,
        },
      },
    },
  },
});
