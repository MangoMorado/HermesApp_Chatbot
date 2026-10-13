import { DELETE, GET, PATCH, POST, PUT } from "@/app/fhir/[[...path]]/route";
import { authedRequest, signToken } from "./token";

const WRITERS = { POST, PUT, PATCH, DELETE };

function segmentsOf(url: URL): string[] {
  return url.pathname
    .replace(/^\/fhir\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
}

function requestFor(url: URL, token: string | undefined, method: string): Request {
  return token ? authedRequest(url.toString(), token, { method }) : new Request(url, { method });
}

/** `GET /fhir/<pathAndQuery>` contra el handler real. */
export async function fhirGet(pathAndQuery: string, token?: string) {
  const url = new URL(`http://localhost/fhir/${pathAndQuery}`);
  const response = await GET(requestFor(url, token, "GET"), {
    params: Promise.resolve({ path: segmentsOf(url) }),
  });
  return { response, body: await response.json() };
}

export async function fhirSend(method: keyof typeof WRITERS, path: string, token?: string) {
  const url = new URL(`http://localhost/fhir/${path}`);
  const response = await WRITERS[method](requestFor(url, token, method), {
    params: Promise.resolve({ path: segmentsOf(url) }),
  });
  return { response, body: await response.json() };
}

export function serviceToken(tenantId: string): Promise<string> {
  return signToken({ role: "service", tenantId, subject: `hermes-${tenantId}` });
}
