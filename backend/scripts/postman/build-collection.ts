import { authPrerequest } from "./auth";
import { catalogItems, FOLDER_PROFILES } from "./catalog";
import { event, type Fragment, type PostmanItem, stableId } from "./items";

export type { Fragment, PostmanItem } from "./items";

export const CATALOG_FOLDER = "catálogo";
export const MANUAL_FOLDER = "manual — rompe el laboratorio";

export type PostmanCollection = {
  info: { _postman_id: string; name: string; description: string; schema: string };
  item: PostmanItem[];
};

const DESCRIPTION = [
  "Contrato REST publicado (Fase 5.3). Generada por `npm --prefix backend run postman:generate`:",
  "no se edita a mano (la suite `contrato-api` compara este archivo con el generador).",
  "",
  "Las carpetas de recorrido (todas menos `catálogo`) son lo que ejecuta Newman",
  "(`npm --prefix backend run postman:run -- --env <entorno>`) y se deshacen solas.",
  "`catálogo` trae una petición por operación para explorar a mano; su subcarpeta",
  `\`${MANUAL_FOLDER}\` rota la clave del widget o reescribe su cliente: úsala a conciencia.`,
  "",
  "Los tokens se piden por script contra `{{oidc_token_url}}` (variables del entorno:",
  "`docs/lab.postman_environment.template.json`, valores desde `idp:lab`). `/fhir` vive en",
  "las carpetas de recorrido; su contrato es `GET /fhir/metadata`.",
].join("\n");

function folder(name: string, item: PostmanItem[], prerequest?: string[]): PostmanItem {
  const result: PostmanItem = { id: stableId(`folder ${name}`), name, item };
  return prerequest ? { ...result, event: [event("prerequest", prerequest)] } : result;
}

function catalogFolder(): PostmanItem {
  const { bySurface, manual } = catalogItems();
  const surfaces = (["chatbot", "platform", "sim"] as const).map((surface) =>
    folder(surface, bySurface[surface], authPrerequest(FOLDER_PROFILES[surface])),
  );
  const manualFolder = folder(MANUAL_FOLDER, manual, authPrerequest(FOLDER_PROFILES.chatbot));
  // La de plataforma necesita su cliente: perfil propio en la peticion.
  for (const item of manual) {
    if (item.name.startsWith("PUT /api/platform/")) {
      item.event = [
        event("prerequest", authPrerequest({ client: "platform" })),
        ...(item.event ?? []),
      ];
    }
  }
  return folder(CATALOG_FOLDER, [...surfaces, manualFolder]);
}

/** Primero los recorridos (lo que ejecuta Newman), despues el catalogo generado. */
export function buildPostmanCollection(fragments: readonly Fragment[]): PostmanCollection {
  return {
    info: {
      _postman_id: stableId("chatbot-ingenius-360"),
      name: "Chatbot Ingenius 360",
      description: DESCRIPTION,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [
      ...fragments.map((fragment) => folder(fragment.name, fragment.item, fragment.prerequest)),
      catalogFolder(),
    ],
  };
}

/** Carpetas que ejecuta Newman, en orden. Nunca el catalogo. */
export function newmanFolders(fragments: readonly Fragment[]): string[] {
  return fragments.map((fragment) => fragment.name).filter((name) => name !== CATALOG_FOLDER);
}
