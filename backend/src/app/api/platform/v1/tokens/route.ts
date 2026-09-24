import { getContainer } from "@/composition-root";
import { platformRoute, readJsonBody } from "@/http/platform-route";

export const dynamic = "force-dynamic";

export const POST = platformRoute(async ({ requestId, request }) => {
  const issued = await getContainer().issueToken({ raw: await readJsonBody(request), requestId });
  return { token: issued.token, expires_at: issued.expiresAt.toISOString() };
});
