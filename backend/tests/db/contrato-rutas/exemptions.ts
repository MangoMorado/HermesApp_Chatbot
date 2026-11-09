/**
 * Pares (operacion, status) declarados que `contrato-rutas` no reproduce, cada uno con su
 * motivo. Clave: `"<surface> <METHOD> <path>"`. Una exencion sin motivo rompe la suite.
 */
type Reasons = Readonly<Partial<Record<number, string>>>;

const COLLECTION_404 =
  "coleccion del tenant del token: no hay id ajeno que nombrar y un filtro ajeno da pagina vacia";
const SINGLETON_404 = "recurso unico del tenant del token: no hay recurso ajeno que nombrar";
const CREATE_404 = "alta en el tenant del token: no nombra ningun recurso existente";
const NO_INPUT_422 = "sin query ni cuerpo que validar";

const singletonRead: Reasons = { 404: SINGLETON_404, 422: NO_INPUT_422 };

/** Colecciones CRUD del simulador: la lista y el alta no nombran recursos; la lectura no valida. */
function simCollections(collections: readonly string[]): Record<string, Reasons> {
  return Object.fromEntries(
    collections.flatMap((collection) => [
      [`sim GET ${collection}`, { 404: COLLECTION_404 }],
      [`sim POST ${collection}`, { 404: CREATE_404 }],
      [`sim GET ${collection}/{id}`, { 422: NO_INPUT_422 }],
    ]),
  );
}

export const EXEMPTIONS: Readonly<Record<string, Reasons>> = {
  "chatbot GET /practitioners": { 404: COLLECTION_404 },
  "chatbot GET /healthcare-services": { 404: COLLECTION_404 },
  "chatbot GET /schedules": { 404: COLLECTION_404 },
  "chatbot GET /availability": { 404: COLLECTION_404 },
  "chatbot GET /knowledge-entries": { 404: COLLECTION_404 },
  "chatbot GET /medical-records/{id}": { 422: NO_INPUT_422 },
  "chatbot GET /knowledge-entries/{id}": { 422: NO_INPUT_422 },
  "chatbot GET /tenant-settings": singletonRead,
  "chatbot GET /bot-config": singletonRead,
  "chatbot PATCH /tenant-settings": { 404: SINGLETON_404 },
  "chatbot PATCH /bot-config": { 404: SINGLETON_404 },
  "chatbot POST /bot-config/widget-keys/rotate": { 404: SINGLETON_404 },
  "chatbot POST /bot-config/allowed-origins": { 404: SINGLETON_404 },
  "chatbot POST /knowledge-entries": { 404: CREATE_404 },
  "platform GET /me": {
    404: "identidad del propio token: no nombra ningun recurso",
    422: NO_INPUT_422,
  },
  "platform GET /tenants": { 404: "coleccion de plataforma: no nombra ningun recurso" },
  "platform POST /tenants": { 404: CREATE_404 },
  ...simCollections(["/practitioners", "/healthcare-services", "/patients"]),
  // POST /schedules no se exime del 404: nombra profesional y servicio, y uno ajeno da 404.
  "sim GET /schedules": { 404: COLLECTION_404 },
  "sim GET /schedules/{id}": { 422: NO_INPUT_422 },
  "sim GET /inbox": { 404: COLLECTION_404 },
  "chatbot GET /widget/conversation": {
    422: "sin query ni cuerpo; la cabecera X-Conversation-Secret ausente es 404 (no divulgacion)",
  },
};
