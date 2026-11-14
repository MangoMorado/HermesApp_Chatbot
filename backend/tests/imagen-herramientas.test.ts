import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La etapa `tools` del Dockerfile copia solo una parte de `src/`. Si la siembra o la demo
 * importan un archivo que no se copia, `npm run db:seed` falla dentro del contenedor
 * (MODULE_NOT_FOUND), aunque todo pase en local.
 */
const ROOT = resolve(__dirname, "..");
const ENTRIES = ["prisma/seed/index.ts", "scripts/demo.ts"];
const IMPORT = /(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = join(ROOT, "src", spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = resolve(dirname(from), spec);
  } else {
    return null;
  }
  const candidates = [`${base}.ts`, join(base, "index.ts"), base];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function sourceFilesImported(): string[] {
  const seen = new Set<string>();
  const pending = ENTRIES.map((e) => join(ROOT, e));
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const target = resolveImport(file, match[1] ?? match[2] ?? "");
      if (target) pending.push(target);
    }
  }
  return [...seen]
    .map((f) => relative(ROOT, f).split(sep).join("/"))
    .filter((f) => f.startsWith("src/"));
}

function toolsCopies(): string[] {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  const stage = dockerfile.split(/^FROM /m).find((s) => /AS tools\b/.test(s)) ?? "";
  return [...stage.matchAll(/^COPY (src\/\S+) /gm)].map((m) => m[1] ?? "");
}

describe("imagen de herramientas", () => {
  it("copia todo lo de src/ que importan la siembra y la demo", () => {
    const copies = toolsCopies();
    const missing = sourceFilesImported().filter(
      (file) => !copies.some((dir) => file === dir || file.startsWith(`${dir}/`)),
    );
    expect(missing).toEqual([]);
  });
});
