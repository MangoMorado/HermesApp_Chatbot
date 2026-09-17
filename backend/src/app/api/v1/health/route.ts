import { NextResponse } from "next/server";
import { getContainer } from "@/composition-root";

export const dynamic = "force-dynamic";

/** Adaptador de entrada HTTP. Sin reglas: delega en el caso de uso y serializa. */
export function GET(): NextResponse {
  const { checkHealth } = getContainer();
  return NextResponse.json(checkHealth());
}
