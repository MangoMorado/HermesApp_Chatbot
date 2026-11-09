/**
 * Ejecuta los recorridos de la coleccion con Newman (nunca el catalogo). No entra en el CI:
 * se lanza a mano contra el laboratorio (spec 5.3 §4.5).
 *
 * Uso: npm --prefix backend run postman:run -- --env <ruta-al-entorno.postman_environment.json>
 */
import { readFileSync } from "node:fs";
import newman from "newman";
import { newmanFolders } from "./build-collection";
import { FRAGMENTS } from "./fragments";
import { COLLECTION_PATH } from "./paths";

function environmentPath(argv: readonly string[]): string | null {
  const index = argv.indexOf("--env");
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : null;
}

const env = environmentPath(process.argv.slice(2));
if (!env) {
  console.error(
    "Falta --env <ruta>: el entorno de Postman con los valores del laboratorio " +
      "(LAB_POSTMAN_ENV_OUT de idp:lab, o la plantilla docs/lab.postman_environment.template.json rellena).",
  );
  process.exit(1);
}

newman.run(
  {
    collection: JSON.parse(readFileSync(COLLECTION_PATH, "utf8")),
    environment: JSON.parse(readFileSync(env, "utf8")),
    folder: newmanFolders(FRAGMENTS),
    reporters: ["cli"],
  },
  (error, summary) => {
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    const failures = summary.run.failures.length;
    process.exit(failures > 0 ? 1 : 0);
  },
);
