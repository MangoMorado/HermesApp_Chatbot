/** Cliente minimo de la API de administracion (Keycloak 26.x). Solo fetch; sin logica de plan. */
export type Json = Record<string, unknown>;

export type AdminConfig = {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
};

export class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchClientToken(
  baseUrl: string,
  realm: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) throw new AdminError(response.status, `token ${clientId}: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

/** Token de admin del realm `master`: dura poco (60 s por defecto), asi que se renueva ante un 401. */
function requestToken(config: AdminConfig): Promise<string> {
  return fetchClientToken(config.baseUrl, config.realm, config.clientId, config.clientSecret);
}

export class AdminClient {
  private constructor(
    private readonly config: AdminConfig,
    private token: string,
  ) {}

  static async connect(config: AdminConfig): Promise<AdminClient> {
    return new AdminClient(config, await requestToken(config));
  }

  private send(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.config.baseUrl}/admin/realms${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Devuelve el JSON, o null si la respuesta no trae cuerpo; 404 en GET devuelve null. */
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let response = await this.send(method, path, body);
    if (response.status === 401) {
      this.token = await requestToken(this.config);
      response = await this.send(method, path, body);
    }
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok) {
      throw new AdminError(
        response.status,
        `${method} ${path}: ${response.status} ${await response.text()}`,
      );
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  get = (path: string): Promise<unknown> => this.request("GET", path);
  post = (path: string, body: unknown): Promise<unknown> => this.request("POST", path, body);
  put = (path: string, body?: unknown): Promise<unknown> => this.request("PUT", path, body);
}
