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

  it("los modulos de la Fase 3 solo importan shared y auth de otros modulos", () => {
    const phase3 = [
      "bot-config",
      "knowledge",
      "widget",
      "platform",
      "verification",
      "handoff",
      "conversation",
    ];
    // conversation evalua respuestas con el dominio puro de verification (refinamiento 4).
    const extra: Record<string, RegExp> = { conversation: /modules\/verification\/domain\// };
    const offenders = phase3.flatMap((mod) => {
      const allowed = new Set([mod, "shared", "auth"]);
      return listFiles(join(MODULES_DIR, mod)).flatMap((file) =>
        importsOf(file)
          .map((specifier) => ({ specifier, module: /modules\/([^/]+)/.exec(specifier)?.[1] }))
          .filter(({ module }) => module !== undefined && !allowed.has(module))
          .filter(({ specifier }) => !extra[mod]?.test(specifier))
          .map(({ specifier }) => `${file} -> ${specifier}`),
      );
    });

    expect(offenders).toEqual([]);
  });

  it("conversation solo toma el dominio de verification", () => {
    const offenders = listFiles(join(MODULES_DIR, "conversation")).flatMap((file) =>
      importsOf(file)
        .filter((specifier) =>
          /modules\/verification\/(application|infrastructure)\//.test(specifier),
        )
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("scheduling no importa bot-config ni hermes-simulator", () => {
    const offenders = listFiles(join(MODULES_DIR, "scheduling")).flatMap((file) =>
      importsOf(file)
        .filter((specifier) => /modules\/(bot-config|hermes-simulator)(\/|$)/.test(specifier))
        .map((specifier) => `${file} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("fhir solo importa shared y auth, y ningun modulo importa fhir", () => {
    const allowed = new Set(["fhir", "shared", "auth"]);
    const outgoing = listFiles(join(MODULES_DIR, "fhir")).flatMap((file) =>
      importsOf(file)
        .map((specifier) => ({ specifier, module: /modules\/([^/]+)/.exec(specifier)?.[1] }))
        .filter(({ module }) => module !== undefined && !allowed.has(module))
        .map(({ specifier }) => `${file} -> ${specifier}`),
    );
    const incoming = readdirSync(MODULES_DIR)
      .filter((entry) => entry !== "fhir" && statSync(join(MODULES_DIR, entry)).isDirectory())
      .flatMap((mod) => listFiles(join(MODULES_DIR, mod)))
      .flatMap((file) =>
        importsOf(file)
          .filter((specifier) => /(^|\/)modules\/fhir(\/|$)/.test(specifier))
          .map((specifier) => `${file} -> ${specifier}`),
      );

    expect(listFiles(join(MODULES_DIR, "fhir")).length).toBeGreaterThan(0);
    expect([...outgoing, ...incoming]).toEqual([]);
  });
});
