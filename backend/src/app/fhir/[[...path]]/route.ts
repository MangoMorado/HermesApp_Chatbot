import { handleFhirRead, handleFhirWrite } from "@/http/fhir-dispatch";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path?: string[] }> };

export const GET = async (request: Request, context: RouteContext): Promise<Response> =>
  handleFhirRead(request, (await context.params).path ?? []);

const write = async (request: Request, context: RouteContext): Promise<Response> =>
  handleFhirWrite(request, (await context.params).path ?? []);

export const POST = write;
export const PUT = write;
export const PATCH = write;
export const DELETE = write;
