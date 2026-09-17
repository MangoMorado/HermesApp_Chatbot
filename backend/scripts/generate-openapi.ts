import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApiDocument } from "../src/http/openapi";

const target = join(process.cwd(), "openapi.json");
writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`, "utf8");
process.stdout.write(`openapi.json regenerado en ${target}\n`);
