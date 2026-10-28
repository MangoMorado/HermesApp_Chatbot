import { getContainer } from "@/composition-root";
import { publicRoute } from "@/http/route";

export const dynamic = "force-dynamic";

const handler = publicRoute(async ({ request }) => {
  const form = await request.formData().catch(() => null);
  await getContainer().closeProviderSession(form?.get("logout_token"));
  return {};
});

/**
 * Back-channel logout OIDC. Lo llama el proveedor servidor a servidor: sin bearer, sin
 * CSRF ni CORS. La autenticidad la prueba la firma del logout_token.
 */
export async function POST(request: Request): Promise<Response> {
  const response = await handler(request);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
