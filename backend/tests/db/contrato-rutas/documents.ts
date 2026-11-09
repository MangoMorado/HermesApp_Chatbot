import { buildOpenApiDocument } from "@/http/openapi";
import { buildPlatformOpenApiDocument } from "@/http/openapi-platform";
import { buildSimOpenApiDocument } from "@/http/openapi-sim";
import type { HttpMethod, Surface } from "./types";

export type OpenApiResponse = {
  description?: string;
  headers?: Record<string, unknown>;
  content?: Record<string, { schema?: unknown }>;
};

export type OpenApiDocument = {
  components: { schemas: Record<string, unknown> };
  paths: Record<string, Partial<Record<HttpMethod, { responses: Record<string, unknown> }>>>;
};

export type DeclaredOperation = {
  readonly key: string;
  readonly surface: Surface;
  readonly method: HttpMethod;
  readonly path: string;
  readonly responses: Record<string, OpenApiResponse>;
};

const BUILDERS: Record<Surface, () => unknown> = {
  chatbot: buildOpenApiDocument,
  platform: buildPlatformOpenApiDocument,
  sim: buildSimOpenApiDocument,
};

const METHODS: readonly HttpMethod[] = ["get", "post", "put", "patch", "delete"];

/** El documento sale del builder, no del JSON del disco. */
export function contractDocument(surface: Surface): OpenApiDocument {
  return BUILDERS[surface]() as OpenApiDocument;
}

export function operationKey(surface: Surface, method: HttpMethod, path: string): string {
  return `${surface} ${method.toUpperCase()} ${path}`;
}

export function declaredOperations(surface: Surface): DeclaredOperation[] {
  const document = contractDocument(surface);
  return Object.entries(document.paths).flatMap(([path, item]) =>
    METHODS.flatMap((method) => {
      const operation = item[method];
      if (!operation) {
        return [];
      }
      return [
        {
          key: operationKey(surface, method, path),
          surface,
          method,
          path,
          responses: operation.responses as Record<string, OpenApiResponse>,
        },
      ];
    }),
  );
}
