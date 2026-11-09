import { platformRoute } from "@/http/platform-route";

export const dynamic = "force-dynamic";

/** Identidad de plataforma: `/api/v1/me` no acepta `platform` (no vive en un tenant). */
export const GET = platformRoute(async ({ actor }) => ({
  subject: actor.subject,
  role: actor.role,
}));
