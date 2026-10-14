import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Raíz del kit de la skill anatomy; ANATOMY_KIT la sobreescribe.
export const KIT_ROOT = process.env.ANATOMY_KIT ?? join(homedir(), ".claude", "skills", "anatomy");
export const kitUrl = (relative) => pathToFileURL(join(KIT_ROOT, relative)).href;
