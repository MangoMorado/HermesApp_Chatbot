import { docsRoute } from "@/http/docs/guard";
import { docsPage } from "@/http/docs/page";

export const dynamic = "force-dynamic";

/** Swagger UI con los contratos ofrecidos (spec 5.3 §3.2). */
export const GET = (_request: Request): Promise<Response> =>
  docsRoute(
    (docs) =>
      new Response(docsPage({ contracts: docs.contracts, oidcClientId: docs.oidcClientId }), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      }),
  );
