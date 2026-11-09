/**
 * Regenera la coleccion Postman y la plantilla de entorno desde los builders OpenAPI y los
 * fragmentos de `fragments/`. Uso: npm --prefix backend run postman:generate
 */
import { writeFileSync } from "node:fs";
import { buildPostmanCollection } from "./build-collection";
import { buildEnvironmentTemplate } from "./environment";
import { FRAGMENTS } from "./fragments";
import { COLLECTION_PATH, ENVIRONMENT_TEMPLATE_PATH, serialized } from "./paths";

writeFileSync(COLLECTION_PATH, serialized(buildPostmanCollection(FRAGMENTS)), "utf8");
process.stdout.write(`Coleccion regenerada en ${COLLECTION_PATH}\n`);
writeFileSync(ENVIRONMENT_TEMPLATE_PATH, serialized(buildEnvironmentTemplate()), "utf8");
process.stdout.write(`Plantilla de entorno regenerada en ${ENVIRONMENT_TEMPLATE_PATH}\n`);
