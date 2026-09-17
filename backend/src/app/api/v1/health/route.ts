import { getContainer } from "@/composition-root";
import { publicRoute } from "@/http/route";

export const dynamic = "force-dynamic";

/** Adaptador de entrada HTTP. Sin reglas: delega en el caso de uso y serializa. */
export const GET = publicRoute(() => getContainer().checkHealth());
