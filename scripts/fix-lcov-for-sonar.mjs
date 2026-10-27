/**
 * Vitest emite SF:src/... relativo al paquete; Sonar analiza desde la raíz del
 * monorepo y espera backend/src/... o frontend/src/.... También normaliza
 * barras de Windows para que coincidan con sonar.sources.
 *
 * Uso: node scripts/fix-lcov-for-sonar.mjs <lcov.info> <prefijo>
 * Ejemplo: node scripts/fix-lcov-for-sonar.mjs coverage/lcov.info backend/
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const reportPath = process.argv[2];
const prefix = process.argv[3];

if (!reportPath || !prefix) {
  console.error("Uso: node scripts/fix-lcov-for-sonar.mjs <lcov.info> <prefijo>/");
  process.exit(1);
}

const absolute = resolve(reportPath);
const original = readFileSync(absolute, "utf8");
const fixed = original.replaceAll("\\", "/").replace(/^SF:(?:\.\/)?src\//gm, `SF:${prefix}src/`);

if (fixed === original) {
  process.stdout.write(`LCOV sin cambios de ruta: ${absolute}\n`);
} else {
  writeFileSync(absolute, fixed);
  const samples = [...fixed.matchAll(/^SF:.+$/gm)].slice(0, 3).map((m) => m[0]);
  process.stdout.write(`LCOV reescrito con prefijo "${prefix}": ${absolute}\n`);
  for (const sample of samples) {
    process.stdout.write(`  ${sample}\n`);
  }
}
