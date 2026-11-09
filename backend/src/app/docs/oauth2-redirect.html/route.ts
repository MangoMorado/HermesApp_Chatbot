import { docsRoute } from "@/http/docs/guard";
import { oauth2RedirectPage } from "@/http/docs/page";

export const dynamic = "force-dynamic";

/** Retorno del flujo authorizationCode de Swagger UI. */
export const GET = (_request: Request): Promise<Response> =>
  docsRoute(
    () =>
      new Response(oauth2RedirectPage(), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      }),
  );
