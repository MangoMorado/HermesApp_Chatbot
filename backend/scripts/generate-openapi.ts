import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApiDocument } from "../src/http/openapi";
import { buildPlatformOpenApiDocument } from "../src/http/openapi-platform";
import { buildSimOpenApiDocument } from "../src/http/openapi-sim";

const root = process.cwd();
const chatbot = join(root, "openapi.json");
const sim = join(root, "openapi-sim.json");
writeFileSync(chatbot, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`, "utf8");
writeFileSync(sim, `${JSON.stringify(buildSimOpenApiDocument(), null, 2)}\n`, "utf8");
process.stdout.write(`openapi.json regenerado en ${chatbot}\n`);
process.stdout.write(`openapi-sim.json regenerado en ${sim}\n`);

const platform = join(root, "openapi-platform.json");
writeFileSync(platform, `${JSON.stringify(buildPlatformOpenApiDocument(), null, 2)}\n`, "utf8");
process.stdout.write(`openapi-platform.json regenerado en ${platform}\n`);
