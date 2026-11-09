import { docsAsset } from "@/http/docs/assets";
import { docsRoute, notFound } from "@/http/docs/guard";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ file: string }> };

export const GET = (_request: Request, context: RouteContext): Promise<Response> =>
  docsRoute(async () => {
    const { file } = await context.params;
    return (await docsAsset(file)) ?? notFound();
  });
