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

export class AdminClient {
  private constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  static async connect(config: AdminConfig): Promise<AdminClient> {
    const token = await fetchClientToken(
      config.baseUrl,
      config.realm,
      config.clientId,
      config.clientSecret,
    );
    return new AdminClient(config.baseUrl, token);
  }

  /** Devuelve el JSON, o null si la respuesta no trae cuerpo; 404 en GET devuelve null. */
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/admin/realms${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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
