import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** GOBERNANZA §1.1: ningun LLM, embedding, RAG, base vectorial ni n8n. */
const FORBIDDEN = [
  /^openai$/,
  /^@anthropic-ai\//,
  /^@google\/(generative-ai|genai)$/,
  /^@google-cloud\/(vertexai|aiplatform)$/,
  /^langchain$/,
  /^@langchain\//,
  /^llamaindex$/,
  /^cohere-ai$/,
  /^@mistralai\//,
  /^ollama$/,
  /^@huggingface\//,
  /^@xenova\/transformers$/,
  /^@tensorflow\//,
  /^ai$/,
  /^@ai-sdk\//,
  /^n8n/,
  /^@n8n\//,
  /^@pinecone-database\//,
  /^chromadb$/,
  /^@qdrant\//,
  /^weaviate/,
  /^pgvector$/,
];

const ROOT = join(process.cwd(), "..");
const PACKAGES = ["package.json", "backend/package.json", "frontend/package.json"];
const SOURCES = ["backend/src", "backend/scripts", "backend/prisma", "frontend/src"];
const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

const isForbidden = (name: string) => FORBIDDEN.some((pattern) => pattern.test(name));

function listSources(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "node_modules" ? [] : listSources(full);
    }
    return /\.(ts|tsx|mts|js|mjs)$/.test(entry) ? [full] : [];
  });
}

function dependenciesOf(file: string): string[] {
  const manifest = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as Record<string, unknown>;
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap(
    (field) => Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}),
  );
}

describe("sin-ia", () => {
  it("ningun package.json declara dependencias de IA ni n8n", () => {
    const offenders = PACKAGES.flatMap((file) =>
      dependenciesOf(file)
        .filter(isForbidden)
        .map((name) => `${file}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("ningun archivo fuente importa paquetes de IA ni n8n", () => {
    const offenders = SOURCES.flatMap((dir) => listSources(join(ROOT, dir))).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)]
        .map((match) => match[1] as string)
        .filter(isForbidden)
        .map((specifier) => `${file} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("el despliegue no levanta n8n", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");
    expect(compose).not.toMatch(/n8n/i);
  });

  it("el detector reconoce lo que debe bloquear", () => {
    expect(
      ["openai", "@langchain/core", "n8n-core", "ai", "@ai-sdk/openai"].every(isForbidden),
    ).toBe(true);
    expect(["jose", "next", "@prisma/client", "aigle"].some(isForbidden)).toBe(false);
  });
});
