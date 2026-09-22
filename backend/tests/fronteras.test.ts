import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES_DIR = join(process.cwd(), "src", "modules");
const INNER_LAYERS = ["domain", "application"];

/** Lo que el nucleo no puede importar: framework, ORM, runtime de Node, UI. */
const FORBIDDEN = [/^next(\/|$)/, /^@prisma\/client(\/|$)/, /^node:/, /^react(-dom)?(\/|$)/];

const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

function listFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return listFiles(full);
    }
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

function innerLayerFiles(): string[] {
  let modules: string[];
  try {
    modules = readdirSync(MODULES_DIR).filter((entry) =>
      statSync(join(MODULES_DIR, entry)).isDirectory(),
    );
  } catch {
    return [];
  }
  return modules.flatMap((mod) =>
    INNER_LAYERS.flatMap((layer) => listFiles(join(MODULES_DIR, mod, layer))),
  );
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1] as string);
}

describe("fronteras de capas", () => {
  it("domain y application no dependen de framework, ORM ni node:*", () => {
    const offenders = innerLayerFiles().flatMap((file) =>
      importsOf(file)
        .filter((specifier) => FORBIDDEN.some((pattern) => pattern.test(specifier)))
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("domain no importa de application ni de infrastructure", () => {
    const domainFiles = readdirSync(MODULES_DIR)
      .filter((entry) => statSync(join(MODULES_DIR, entry)).isDirectory())
      .flatMap((mod) => listFiles(join(MODULES_DIR, mod, "domain")));

    const offenders = domainFiles.flatMap((file) =>
      importsOf(file)
        .filter((specifier) => /(^|\/)(application|infrastructure)\//.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("ningun modulo del chatbot importa hermes-simulator", () => {
    const chatbotModules = readdirSync(MODULES_DIR).filter(
      (entry) => entry !== "hermes-simulator" && statSync(join(MODULES_DIR, entry)).isDirectory(),
    );
    const offenders = chatbotModules
      .flatMap((mod) => listFiles(join(MODULES_DIR, mod)))
      .flatMap((file) =>
        importsOf(file)
          .filter((specifier) => /(^|\/)hermes-simulator(\/|$)/.test(specifier))
          .map((specifier) => `${file} -> ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  it("hermes-simulator solo importa shared y auth de otros modulos", () => {
    const allowed = new Set(["hermes-simulator", "shared", "auth"]);
    const offenders = listFiles(join(MODULES_DIR, "hermes-simulator")).flatMap((file) =>
      importsOf(file)
        .map((specifier) => ({ specifier, module: /modules\/([^/]+)/.exec(specifier)?.[1] }))
        .filter(({ module }) => module !== undefined && !allowed.has(module))
        .map(({ specifier }) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });
});
