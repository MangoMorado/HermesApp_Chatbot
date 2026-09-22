import { backendUrl } from "@/config/env";
import { forward } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return forward(request, backendUrl(), path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
