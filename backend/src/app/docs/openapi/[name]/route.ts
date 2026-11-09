import { docsRoute, notFound } from "@/http/docs/guard";
import { errorResponse, toApiError } from "@/http/errors";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/http/request-id";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

const SUFFIX = ".json";

/** Contrato con los endpoints del proveedor; discovery caido → `503` con la envoltura REST. */
export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  docsRoute(async (docs) => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const { name } = await context.params;
    if (!name.endsWith(SUFFIX)) {
      return notFound();
    }
    try {
      const document = await docs.servedDocument(name.slice(0, -SUFFIX.length));
      if (document === null) {
        return notFound();
      }
      return Response.json(document, {
        headers: { [REQUEST_ID_HEADER]: requestId, "Cache-Control": "no-store" },
      });
    } catch (error) {
      return errorResponse(toApiError(error), requestId);
    }
  });
